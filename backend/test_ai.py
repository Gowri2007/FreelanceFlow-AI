from ai_service import generate_invoice_details

description = """
Designed a business website homepage.
Developed three responsive pages.
Fixed mobile layout issues.
"""

try:
    result = generate_invoice_details(description)
    print("Gemini AI response:")
    print(result)

except Exception as error:
    print("Error:", error)