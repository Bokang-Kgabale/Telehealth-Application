import os
import io
import json
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from google.cloud import vision
from PIL import Image
import re

# Set Google Cloud credentials
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = "vision-key.json"  # Update path

client = vision.ImageAnnotatorClient()

@csrf_exempt
def upload_image(request):
    if request.method == 'POST':
        image_file = request.FILES.get('image')
        capture_type = request.POST.get('type')  # 'temperature' or 'weight'

        if not image_file:
            return JsonResponse({'error': 'No image uploaded'}, status=400)

        # Convert image to byte format
        image = Image.open(image_file)
        img_byte_arr = io.BytesIO()
        image.save(img_byte_arr, format='JPEG')
        content = img_byte_arr.getvalue()

        # Send image to Google OCR
        vision_image = vision.Image(content=content)
        response = client.text_detection(image=vision_image)
        texts = response.text_annotations

        raw_text = texts[0].description if texts else "No text found"
        extracted_value = extract_numbers(raw_text, capture_type)

        return JsonResponse({
            "capture_type": capture_type,
            "raw_text": raw_text,
            "formatted_value": extracted_value  # Will include "Kg" or "°C"
        })

    return JsonResponse({"error": "Invalid request"}, status=400)


def extract_numbers(text, capture_type):
    """Extracts numerical values and appends 'Kg' or '°C' based on type."""
    number_pattern = re.compile(r"\d+\.\d+|\d+")
    numbers = number_pattern.findall(text)

    if numbers:
        value = float(numbers[0])  # Take the first detected number
        if capture_type == 'weight':
            return f"{value} Kg"
        elif capture_type == 'temperature':
            return f"{value}°C"

    return "No valid number found"
