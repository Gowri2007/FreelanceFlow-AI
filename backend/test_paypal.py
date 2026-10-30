
from paypal_service import get_paypal_access_token

try:
    token = get_paypal_access_token()

    if token:
        print("SUCCESS: Connected to PayPal Sandbox!")
        print("Access token received successfully.")

except Exception as error:
    print("PayPal connection failed:")
    print(error)
