from datetime import datetime
import secrets
from sqlalchemy import (
    Column, Integer, String, Float, Date,
    ForeignKey, DateTime
)
from sqlalchemy.orm import relationship
from datetime import datetime

from database import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    email = Column(String(150), nullable=False)
    company = Column(String(150))
    phone = Column(String(30))

    invoices = relationship("Invoice", back_populates="client")


class Invoice(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    invoice_number = Column(String(50), unique=True, nullable=False)
    client_id = Column(Integer, ForeignKey("clients.id"))
    issue_date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=False)
    total_amount = Column(Float, default=0)
    status = Column(String(30), default="draft")
    created_at = Column(DateTime, default=datetime.utcnow)
    payment_token = Column(
    String(128),
    unique=True,
    index=True,
    nullable=True,
    default=lambda: secrets.token_urlsafe(32)
)
    client = relationship("Client", back_populates="invoices")
    items = relationship(
        "InvoiceItem",
        back_populates="invoice",
        cascade="all, delete-orphan"
    )
    payments = relationship(
        "Payment",
        back_populates="invoice"
    )


class InvoiceItem(Base):
    __tablename__ = "invoice_items"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"))
    description = Column(String(500), nullable=False)
    quantity = Column(Float, default=1)
    unit_price = Column(Float, nullable=False)
    amount = Column(Float, nullable=False)

    invoice = relationship("Invoice", back_populates="items")


class Payment(Base):
    __tablename__ = "payments"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"))
    paypal_order_id = Column(String(150), unique=True)
    transaction_id = Column(String(150))
    amount = Column(Float, nullable=False)
    status = Column(String(30), default="pending")
    created_at = Column(DateTime, default=datetime.utcnow)

    invoice = relationship("Invoice", back_populates="payments")
