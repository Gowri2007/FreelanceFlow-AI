
import os
import requests
from dotenv import load_dotenv

load_dotenv()

PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID")
PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET")
PAYPAL_BASE_URL = os.getenv(
    "PAYPAL_BASE_URL",
    "https://api-m.sandbox.paypal.com"
)


def get_paypal_access_token():
    """Get an OAuth access token from PayPal."""

    if not PAYPAL_CLIENT_ID or not PAYPAL_CLIENT_SECRET:
        raise ValueError("PayPal credentials are missing from .env")

    response = requests.post(
        f"{PAYPAL_BASE_URL}/v1/oauth2/token",
        auth=(PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET),
        headers={
            "Accept": "application/json",
            "Accept-Language": "en_US",
        },
        data={"grant_type": "client_credentials"},
        timeout=30,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"PayPal authentication failed: {response.text}"
        )

    return response.json()["access_token"]

def create_paypal_order(amount_usd: float, invoice_number: str):
    """Create a PayPal Sandbox order."""

    access_token = get_paypal_access_token()

    response = requests.post(
        f"{PAYPAL_BASE_URL}/v2/checkout/orders",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        json={
            "intent": "CAPTURE",
            "purchase_units": [
                {
                    "reference_id": invoice_number,
                    "description": f"FreelanceFlow invoice {invoice_number}",
                    "amount": {
                        "currency_code": "USD",
                        "value": f"{amount_usd:.2f}",
                    },
                }
            ],
        },
        timeout=30,
    )

    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"PayPal order creation failed: {response.text}"
        )

    return response.json()


def capture_paypal_order(order_id: str):
    """Capture an approved PayPal Sandbox order."""

    access_token = get_paypal_access_token()

    response = requests.post(
        f"{PAYPAL_BASE_URL}/v2/checkout/orders/{order_id}/capture",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {access_token}",
        },
        timeout=30,
    )

    if response.status_code not in (200, 201):
        raise RuntimeError(
            f"PayPal payment capture failed: {response.text}"
        )

    return response.json()
