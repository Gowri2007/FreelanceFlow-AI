
import os
import base64
import resend
from dotenv import load_dotenv

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")



def send_invoice_email(
    recipient_email: str,
    client_name: str,
    invoice_number: str,
    pdf_content: bytes,
    payment_url: str,
):
    if not resend.api_key:
        raise ValueError("RESEND_API_KEY is missing from .env")

    pdf_base64 = base64.b64encode(pdf_content).decode("utf-8")

    params = {
        "from": "FreelanceFlow <onboarding@resend.dev>",
        "to": [recipient_email],
        "subject": f"Invoice {invoice_number} from FreelanceFlow",
        "html": f"""
            <h2>Hello {client_name},</h2>

            <p>Your invoice from FreelanceFlow is ready.</p>

            <p><b>Invoice Number:</b> {invoice_number}</p>

            <p>Please find your invoice PDF attached.</p>

            <p>
                <a href="{payment_url}"
                   style="background-color:#2563eb;
                          color:white;
                          padding:12px 20px;
                          text-decoration:none;
                          border-radius:6px;
                          display:inline-block;">
                    View Invoice &amp; Pay
                </a>
            </p>

            <p>Thank you for your business!</p>
            <p>Regards,<br>FreelanceFlow</p>
        """,
        "attachments": [
            {
                "filename": f"{invoice_number}.pdf",
                "content": pdf_base64,
            }
        ],
    }

    response = resend.Emails.send(params)
    return response
