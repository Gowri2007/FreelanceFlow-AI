
import os
import json

from dotenv import load_dotenv
from google import genai

# Load API key from .env
load_dotenv()

api_key = os.getenv("GEMINI_API_KEY")

if not api_key:
    raise ValueError("Gemini API key is missing!")

# Connect to Gemini
client = genai.Client(api_key=api_key)


def generate_invoice_details(work_description: str):

    prompt = f"""
    You are an AI assistant for a freelance invoicing application.

    Convert the following work description into professional
    invoice items.

    Work description:
    {work_description}

    Return only valid JSON in this format:

    {{
        "items": [
            {{
                "description": "Professional service description",
                "quantity": 1,
                "unit_price": 0
            }}
        ]
    }}

    Rules:
    - Improve descriptions professionally.
    - Never invent agreed prices.
    - Use 0 for unit_price if no price is provided.
    - Do not invent quantities.
    - Return JSON only, without Markdown.
    """

    response = client.models.generate_content(
        model="gemini-3.8-flash",
        contents=prompt
    )

    result = json.loads(response.text)

    return result
