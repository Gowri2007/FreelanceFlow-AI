
from datetime import date
from pydantic import BaseModel, ConfigDict, Field, EmailStr


# Client schemas
class ClientCreate(BaseModel):
    name: str = Field(min_length=1, max_length=150)
    email: EmailStr
    company: str | None = None
    phone: str | None = None


class ClientResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    email: str
    company: str | None
    phone: str | None


# Invoice item schemas
class InvoiceItemCreate(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    quantity: float = Field(gt=0)
    unit_price: float = Field(ge=0)


class InvoiceCreate(BaseModel):
    client_id: int
    issue_date: date
    due_date: date
    items: list[InvoiceItemCreate] = Field(min_length=1)


class InvoiceItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    description: str
    quantity: float
    unit_price: float
    amount: float


class InvoiceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    invoice_number: str
    client_id: int
    issue_date: date
    due_date: date
    total_amount: float
    status: str
    items: list[InvoiceItemResponse]
class AIInvoiceRequest(BaseModel):
    work_description: str = Field(min_length=10, max_length=5000)
class PayPalCaptureRequest(BaseModel):
    order_id: str = Field(min_length=1, max_length=150)