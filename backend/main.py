
from io import BytesIO
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.units import mm
from schemas import AIInvoiceRequest
from ai_service import generate_invoice_details
from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import desc
from uuid import uuid4
from datetime import date

import models
import schemas
from database import engine, Base, get_db
from email_service import send_invoice_email
from decimal import Decimal, ROUND_HALF_UP
import os
import secrets
from paypal_service import (
    create_paypal_order,
    capture_paypal_order,
)

# Create database tables
Base.metadata.create_all(bind=engine)
# Add payment_token column to existing SQLite databases
with engine.begin() as connection:
    columns = [
        row[1]
        for row in connection.exec_driver_sql(
            "PRAGMA table_info(invoices)"
        ).fetchall()
    ]

    if "payment_token" not in columns:
        connection.exec_driver_sql(
            "ALTER TABLE invoices ADD COLUMN payment_token VARCHAR(128)"
        )

# Initialize FastAPI
app = FastAPI(
    title="FreelanceFlow AI",
    description="Smart Invoicing for Freelancers",
    version="1.0.0"
)


# Allow React frontend to connect
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
        "https://freelance-flow-ai-yvlk.vercel.app",
        "https://freelance-flow-ai-yvlk-ak69xe2zj.vercel.app"

    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------- HOME AND HEALTH ----------------

@app.get("/")
def home():
    return {
        "message": "Welcome to FreelanceFlow AI!",
        "status": "Backend is running successfully"
    }


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "application": "FreelanceFlow AI"
    }


# ---------------- CLIENT APIs ----------------

@app.post("/api/clients", response_model=schemas.ClientResponse)
def create_client(
    client: schemas.ClientCreate,
    db: Session = Depends(get_db)
):
    existing = db.query(models.Client).filter(
        models.Client.email == client.email
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="A client with this email already exists"
        )

    new_client = models.Client(**client.model_dump())

    db.add(new_client)
    db.commit()
    db.refresh(new_client)

    return new_client


@app.get("/api/clients", response_model=list[schemas.ClientResponse])
def get_clients(db: Session = Depends(get_db)):
    return db.query(models.Client).order_by(
        desc(models.Client.id)
    ).all()


@app.get("/api/clients/{client_id}", response_model=schemas.ClientResponse)
def get_client(client_id: int, db: Session = Depends(get_db)):
    client = db.query(models.Client).filter(
        models.Client.id == client_id
    ).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    return client

@app.put("/api/clients/{client_id}", response_model=schemas.ClientResponse)
def update_client(
    client_id: int,
    client_data: schemas.ClientCreate,
    db: Session = Depends(get_db)
):
    client = db.query(models.Client).filter(
        models.Client.id == client_id
    ).first()

    if not client:
        raise HTTPException(
            status_code=404,
            detail="Client not found"
        )

    # Check whether another client already uses this email
    existing = db.query(models.Client).filter(
        models.Client.email == client_data.email,
        models.Client.id != client_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Another client already uses this email"
        )

    # Update client details
    client.name = client_data.name
    client.email = client_data.email
    client.company = client_data.company
    client.phone = client_data.phone

    db.commit()
    db.refresh(client)

    return client
@app.delete("/api/clients/{client_id}")
def delete_client(client_id: int, db: Session = Depends(get_db)):
    client = db.query(models.Client).filter(
        models.Client.id == client_id
    ).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if client.invoices:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a client who has invoices"
        )

    db.delete(client)
    db.commit()

    return {"message": "Client deleted successfully"}


# ---------------- INVOICE APIs ----------------

@app.post("/api/invoices", response_model=schemas.InvoiceResponse)
def create_invoice(
    invoice: schemas.InvoiceCreate,
    db: Session = Depends(get_db)
):
    client = db.query(models.Client).filter(
        models.Client.id == invoice.client_id
    ).first()

    if not client:
        raise HTTPException(status_code=404, detail="Client not found")

    if invoice.due_date < invoice.issue_date:
        raise HTTPException(
            status_code=400,
            detail="Due date cannot be before issue date"
        )

    total = sum(
        item.quantity * item.unit_price
        for item in invoice.items
    )

    new_invoice = models.Invoice(
        invoice_number=f"FF-{uuid4().hex[:8].upper()}",
        client_id=invoice.client_id,
        issue_date=invoice.issue_date,
        due_date=invoice.due_date,
        total_amount=round(total, 2),
        status="draft"
    )

    for item in invoice.items:
        new_invoice.items.append(
            models.InvoiceItem(
                description=item.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                amount=round(
                    item.quantity * item.unit_price, 2
                )
            )
        )

    db.add(new_invoice)
    db.commit()
    db.refresh(new_invoice)

    return new_invoice


@app.get("/api/invoices", response_model=list[schemas.InvoiceResponse])
def get_invoices(db: Session = Depends(get_db)):
    return db.query(models.Invoice).order_by(
        desc(models.Invoice.id)
    ).all()


@app.get("/api/invoices/{invoice_id}", response_model=schemas.InvoiceResponse)
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    return invoice
@app.get("/api/public/invoices/{token}")
def get_public_invoice(token: str, db: Session = Depends(get_db)):

    invoice = db.query(models.Invoice).filter(
        models.Invoice.payment_token == token
    ).first()

    if not invoice:
        raise HTTPException(
            status_code=404,
            detail="Invoice link is invalid or no longer available."
        )

    client = invoice.client

    return {
        "invoice_number": invoice.invoice_number,
        "status": invoice.status,
        "issue_date": invoice.issue_date.isoformat(),
        "due_date": invoice.due_date.isoformat(),
        "total_amount": invoice.total_amount,
        "client": {
            "name": client.name,
            "company": client.company,
        },
        "items": [
            {
                "description": item.description,
                "quantity": item.quantity,
                "unit_price": item.unit_price,
                "amount": item.amount,
            }
            for item in invoice.items
        ],
    }

@app.patch("/api/invoices/{invoice_id}/status")
def update_invoice_status(
    invoice_id: int,
    status: str,
    db: Session = Depends(get_db)
):
    # Paid status will be updated only after verified payment
    allowed_statuses = ["draft", "sent"]

    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Only draft and sent statuses can be manually selected"
        )

    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    invoice.status = status
    db.commit()
    db.refresh(invoice)

    return {
        "message": "Invoice status updated",
        "invoice_id": invoice.id,
        "status": invoice.status
    }



@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(invoice_id: int, db: Session = Depends(get_db)):
    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found"
        )

    # Prevent deletion of paid invoices
    if invoice.status == "paid":
        raise HTTPException(
            status_code=400,
            detail="Cannot delete a paid invoice. Paid invoices are financial records."
        )

    # Prevent deletion if payment records exist
    if invoice.payments:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete an invoice with payment records"
        )

    db.delete(invoice)
    db.commit()

    return {"message": "Invoice deleted successfully"}

# ---------------- DASHBOARD API ----------------

@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    invoices = db.query(models.Invoice).all()

    today = date.today()

    total_invoices = len(invoices)

    paid_invoices = [
        invoice for invoice in invoices
        if invoice.status == "paid"
    ]

    overdue_invoices = [
        invoice for invoice in invoices
        if invoice.status != "paid"
        and invoice.due_date < today
    ]

    pending_invoices = [
        invoice for invoice in invoices
        if invoice.status != "paid"
        and invoice.due_date >= today
    ]

    return {
        "total_invoices": total_invoices,
        "paid_invoices": len(paid_invoices),
        "pending_invoices": len(pending_invoices),
        "overdue_invoices": len(overdue_invoices),
        "total_revenue": round(
            sum(invoice.total_amount for invoice in paid_invoices), 2
        ),
        "outstanding_amount": round(
            sum(
                invoice.total_amount
                for invoice in pending_invoices + overdue_invoices
            ), 2
        )
    }
@app.post("/api/ai/generate-invoice")
def generate_ai_invoice(request: AIInvoiceRequest):

    try:
        result = generate_invoice_details(request.work_description)
        return result

    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f"AI generation failed: {str(error)}"
        )

@app.get("/api/invoices/{invoice_id}/pdf")
def download_invoice_pdf(invoice_id: int, db: Session = Depends(get_db)):

    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    client = invoice.client
    # Generate a unique payment token for this invoice
    
    buffer = BytesIO()

    document = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=20 * mm,
        leftMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
    )

    styles = getSampleStyleSheet()
    content = []

    navy = colors.HexColor("#26334D")
    blue = colors.HexColor("#4169A1")
    light_blue = colors.HexColor("#EEF3FA")
    light_grey = colors.HexColor("#F5F7FA")
    dark_grey = colors.HexColor("#4B5563")

    # 1. Professional invoice header
    header_data = [[
        Paragraph(
            '<font color="#26334D" size="22"><b>FREELANCEFLOW</b></font>',
            styles["Normal"]
        ),
        Paragraph(
            '<font color="#4169A1" size="24"><b>INVOICE</b></font>',
            styles["Normal"]
        )
    ]]

    header = Table(header_data, colWidths=[100 * mm, 70 * mm])
    header.setStyle(TableStyle([
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
        ("LINEBELOW", (0, 0), (-1, -1), 2, blue),
    ]))

    content.append(header)
    content.append(Spacer(1, 20))

    # 2. Invoice information
    details_data = [
        [
            Paragraph("<b>INVOICE NUMBER</b>", styles["Normal"]),
            Paragraph("<b>ISSUE DATE</b>", styles["Normal"]),
            Paragraph("<b>DUE DATE</b>", styles["Normal"]),
        ],
        [
            Paragraph(str(invoice.invoice_number), styles["Normal"]),
            Paragraph(str(invoice.issue_date), styles["Normal"]),
            Paragraph(str(invoice.due_date), styles["Normal"]),
        ],
    ]

    details_table = Table(
        details_data,
        colWidths=[65 * mm, 52.5 * mm, 52.5 * mm]
    )

    details_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), light_blue),
        ("TEXTCOLOR", (0, 0), (-1, 0), navy),
        ("TEXTCOLOR", (0, 1), (-1, 1), dark_grey),
        ("PADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    content.append(details_table)
    content.append(Spacer(1, 25))

    # 3. Client information
    content.append(Paragraph(
        '<font color="#4169A1"><b>BILL TO</b></font>',
        styles["Normal"]
    ))

    content.append(Spacer(1, 6))

    content.append(Paragraph(
        f"<b>{client.name}</b>",
        styles["Normal"]
    ))

    content.append(Paragraph(client.email, styles["Normal"]))

    if client.company:
        content.append(Paragraph(client.company, styles["Normal"]))

    content.append(Spacer(1, 25))

    # 4. Invoice items table
    table_data = [[
        "DESCRIPTION",
        "QTY",
        "UNIT PRICE",
        "AMOUNT"
    ]]

    for item in invoice.items:
        table_data.append([
            Paragraph(str(item.description), styles["Normal"]),
            f"{item.quantity:g}",
            f"Rs. {item.unit_price:,.2f}",
            f"Rs. {item.amount:,.2f}",
        ])

    items_table = Table(
        table_data,
        colWidths=[80 * mm, 20 * mm, 35 * mm, 35 * mm],
        repeatRows=1
    )

    items_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), navy),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1),
         [colors.white, light_grey]),
        ("GRID", (0, 0), (-1, -1), 0.4,
         colors.HexColor("#DCE2EA")),
        ("PADDING", (0, 0), (-1, -1), 10),
        ("ALIGN", (1, 1), (-1, -1), "RIGHT"),
        ("ALIGN", (1, 0), (-1, 0), "RIGHT"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    content.append(items_table)
    content.append(Spacer(1, 20))

    # 5. Highlighted total amount
    total_data = [[
        Paragraph(
            '<font color="#26334D" size="12"><b>TOTAL AMOUNT</b></font>',
            styles["Normal"]
        ),
        Paragraph(
            f'<font color="#26334D" size="16">'
            f'<b>Rs. {invoice.total_amount:,.2f}</b></font>',
            styles["Normal"]
        )
    ]]

    total_table = Table(
        total_data,
        colWidths=[100 * mm, 70 * mm]
    )

    total_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), light_blue),
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("PADDING", (0, 0), (-1, -1), 14),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))

    content.append(total_table)
    content.append(Spacer(1, 22))

    # 6. Payment status
    status = invoice.status.upper()

    status_color = (
        colors.HexColor("#15803D")
        if status == "PAID"
        else colors.HexColor("#B45309")
        if status == "OVERDUE"
        else blue
    )

    status_table = Table([[
        Paragraph(
            f'<font color="#FFFFFF"><b>PAYMENT STATUS: {status}</b></font>',
            styles["Normal"]
        )
    ]], colWidths=[170 * mm])

    status_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), status_color),
        ("PADDING", (0, 0), (-1, -1), 10),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ]))

    content.append(status_table)
    content.append(Spacer(1, 35))

    # 7. Footer
    content.append(Paragraph(
        '<font color="#6B7280" size="9">'
        'Thank you for your business!'
        '</font>',
        styles["Normal"]
    ))

    document.build(content)
    buffer.seek(0)

    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={
            "Content-Disposition":
                f'attachment; filename="{invoice.invoice_number}.pdf"'
        }
    )

@app.post("/api/invoices/{invoice_id}/send")
async def send_invoice(invoice_id: int, db: Session = Depends(get_db)):

    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")

    if invoice.status == "paid":
        raise HTTPException(
            status_code=400,
            detail="This invoice is already paid."
        )

    client = invoice.client
    # Generate a unique payment token for this invoice
    if not invoice.payment_token:
        invoice.payment_token = secrets.token_urlsafe(32)

# Create the client's payment link
    frontend_base_url = os.getenv(
        "FRONTEND_BASE_URL",
        "http://localhost:5173"
    ).rstrip("/")

    payment_url = f"{frontend_base_url}/pay/{invoice.payment_token}"
    try:
        # Generate PDF using the existing PDF endpoint
        pdf_response = download_invoice_pdf(invoice_id, db)

        pdf_content = b"".join([
            chunk async for chunk in pdf_response.body_iterator
        ])

        # Send email with PDF attachment
        email_response = send_invoice_email(
            recipient_email=client.email,
            client_name=client.name,
            invoice_number=invoice.invoice_number,
            pdf_content=pdf_content,
            payment_url=payment_url,
        )

        # Update status only after Resend accepts the email
        invoice.status = "sent"
        db.commit()
        db.refresh(invoice)

        return {
            "message": "Invoice email sent successfully!",
            "invoice_number": invoice.invoice_number,
            "recipient": client.email,
            "status": invoice.status,
            "email_response": str(email_response),
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send invoice email: {str(e)}"
        )
@app.post("/api/invoices/{invoice_id}/paypal/create-order")
def create_invoice_paypal_order(
    invoice_id: int,
    db: Session = Depends(get_db)
):
    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found"
        )

    if invoice.status == "paid":
        raise HTTPException(
            status_code=400,
            detail="This invoice is already paid"
        )

    if invoice.total_amount <= 0:
        raise HTTPException(
            status_code=400,
            detail="Invoice amount must be greater than zero"
        )

    # Prevent another order if a payment was already completed
    completed_payment = db.query(models.Payment).filter(
        models.Payment.invoice_id == invoice_id,
        models.Payment.status == "completed"
    ).first()

    if completed_payment:
        raise HTTPException(
            status_code=400,
            detail="This invoice already has a completed payment"
        )

    # Read the INR-to-USD conversion rate from .env
    try:
        exchange_rate = Decimal(
            os.getenv("PAYPAL_INR_PER_USD", "")
        )

        if exchange_rate <= 0:
            raise ValueError()

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Invalid PAYPAL_INR_PER_USD setting in .env"
        )

    # Convert INR invoice total to USD
    amount_inr = Decimal(str(invoice.total_amount))

    amount_usd = (
        amount_inr / exchange_rate
    ).quantize(
        Decimal("0.01"),
        rounding=ROUND_HALF_UP
    )

    if amount_usd <= 0:
        raise HTTPException(
            status_code=400,
            detail="Converted USD amount is too small to process"
        )

    try:
        paypal_order = create_paypal_order(
            float(amount_usd),
            invoice.invoice_number
        )

    except Exception:
        raise HTTPException(
            status_code=502,
            detail="Could not create PayPal order. Please try again."
        )

    order_id = paypal_order.get("id")

    if not order_id:
        raise HTTPException(
            status_code=502,
            detail="PayPal did not return an order ID"
        )

    # Store the pending payment. Amount is stored in USD.
    payment = models.Payment(
        invoice_id=invoice_id,
        paypal_order_id=order_id,
        amount=float(amount_usd),
        status="pending"
    )

    db.add(payment)
    db.commit()

    return {
        "order_id": order_id,
        "currency": "USD",
        "amount_usd": str(amount_usd),
        "invoice_amount_inr": str(amount_inr),
        "exchange_rate_inr_per_usd": str(exchange_rate)
    }


@app.post("/api/invoices/{invoice_id}/paypal/capture-order")
def capture_invoice_paypal_order(
    invoice_id: int,
    request: schemas.PayPalCaptureRequest,
    db: Session = Depends(get_db)
):
    invoice = db.query(models.Invoice).filter(
        models.Invoice.id == invoice_id
    ).first()

    if not invoice:
        raise HTTPException(
            status_code=404,
            detail="Invoice not found"
        )

    payment = db.query(models.Payment).filter(
        models.Payment.invoice_id == invoice_id,
        models.Payment.paypal_order_id == request.order_id
    ).first()

    if not payment:
        raise HTTPException(
            status_code=404,
            detail="PayPal order not found for this invoice"
        )

    if payment.status == "completed":
        raise HTTPException(
            status_code=400,
            detail="This payment has already been completed"
        )

    try:
        capture_result = capture_paypal_order(request.order_id)

    except Exception:
        raise HTTPException(
            status_code=502,
            detail="PayPal payment capture failed. Please try again."
        )

    # Verify the response received from PayPal
    if capture_result.get("status") != "COMPLETED":
        raise HTTPException(
            status_code=400,
            detail="PayPal has not confirmed a completed payment"
        )

    purchase_units = capture_result.get("purchase_units", [])

    if not purchase_units:
        raise HTTPException(
            status_code=400,
            detail="PayPal payment details are missing"
        )

    purchase_unit = purchase_units[0]

    if purchase_unit.get("reference_id") != invoice.invoice_number:
        raise HTTPException(
            status_code=400,
            detail="Invoice reference does not match"
        )

    captures = (
        purchase_unit
        .get("payments", {})
        .get("captures", [])
    )

    if not captures:
        raise HTTPException(
            status_code=400,
            detail="PayPal capture details are missing"
        )

    capture = captures[0]
    captured_amount = capture.get("amount", {})

    expected_amount = Decimal(str(payment.amount))
    actual_amount = Decimal(str(captured_amount.get("value", "0")))

    if captured_amount.get("currency_code") != "USD":
        raise HTTPException(
            status_code=400,
            detail="Payment currency does not match"
        )

    if actual_amount != expected_amount:
        raise HTTPException(
            status_code=400,
            detail="Payment amount does not match"
        )

    if capture.get("status") != "COMPLETED":
        raise HTTPException(
            status_code=400,
            detail="PayPal capture is not completed"
        )

    # Only now mark the payment and invoice as paid
    payment.status = "completed"
    payment.transaction_id = capture.get("id")
    invoice.status = "paid"

    db.commit()

    return {
        "message": "Payment verified successfully",
        "invoice_id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "payment_status": payment.status,
        "invoice_status": invoice.status,
        "transaction_id": payment.transaction_id
    }

# ---------------- PUBLIC CLIENT PAYMENT APIs ----------------

@app.post("/api/public/invoices/{token}/paypal/create-order")
def create_public_invoice_paypal_order(
    token: str,
    db: Session = Depends(get_db)
):
    # Find the invoice using its secure payment token
    invoice = db.query(models.Invoice).filter(
        models.Invoice.payment_token == token
    ).first()

    if not invoice:
        raise HTTPException(
            status_code=404,
            detail="Invoice link is invalid or no longer available"
        )

    # Reuse the existing PayPal order creation logic
    return create_invoice_paypal_order(invoice.id, db)


@app.post("/api/public/invoices/{token}/paypal/capture-order")
def capture_public_invoice_paypal_order(
    token: str,
    request: schemas.PayPalCaptureRequest,
    db: Session = Depends(get_db)
):
    # Find the invoice using its secure payment token
    invoice = db.query(models.Invoice).filter(
        models.Invoice.payment_token == token
    ).first()

    if not invoice:
        raise HTTPException(
            status_code=404,
            detail="Invoice link is invalid or no longer available"
        )

    # Reuse the existing PayPal capture and verification logic
    return capture_invoice_paypal_order(
        invoice.id,
        request,
        db
    )
