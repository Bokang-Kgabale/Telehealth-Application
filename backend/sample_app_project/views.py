import os
import json
import io
import re
import subprocess
import firebase_admin
from firebase_admin import credentials, db
from google.cloud import vision
from PIL import Image
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_http_methods

# Set up Firebase credentials
base_dir = os.path.dirname(os.path.abspath(__file__))
json_path = os.path.join(base_dir, "..", "config", "fir-rtc-521a2-firebase-adminsdk-fbsvc-5554e5bdfc.json")
cred = credentials.Certificate(json_path)
# Initialize Firebase Admin SDK
firebase_admin.initialize_app(cred, {
    'databaseURL': 'https://fir-rtc-521a2-default-rtdb.firebaseio.com/'
})

# Set up Google Cloud Vision credentials
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.join(
    os.path.dirname(__file__), '..', 'config', 'vision-key.json'
)
client = vision.ImageAnnotatorClient()

@csrf_exempt
@require_http_methods(["POST"])
def upload_image(request):
    if request.method == 'POST':
        image_file = request.FILES.get('image')
        capture_type = request.POST.get('type')  # 'temperature' or 'weight'

        if not image_file:
            return JsonResponse({'error': 'No image uploaded'}, status=400)

        try:
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

            # Save to Firebase
            save_to_firebase(capture_type, raw_text, extracted_value)

            return JsonResponse({
                "capture_type": capture_type,
                "raw_text": raw_text,
                "formatted_value": extracted_value  # Will include "Kg" or "°C"
            })
        except Exception as e:
            return JsonResponse({"error": str(e)}, status=500)
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

def save_to_firebase(capture_type, raw_text, formatted_value):
    """Saves extracted OCR data to Firebase Realtime Database."""
    ref = db.reference(f'/data/{capture_type}')
    ref.push({
        "formatted_value": formatted_value,
        "raw_text": raw_text
    })

@csrf_exempt
@require_http_methods(["GET"])
def start_live_stream(request):
    try:
        # Set the PYTHONPATH to the parent directory of the server folder
        env = os.environ.copy()
        env["PYTHONPATH"] = "c:/Users/User/Downloads/Telehealt-OCR/video-conferencing-app"

        # Run the FastAPI server
        subprocess.Popen(
            ["python", "c:/Users/User/Downloads/Telehealt-OCR/video-conferencing-app/server/main.py"],
            env=env
        )

        # Optionally, you can add a delay here to ensure the server starts before accessing the endpoint
        import time
        time.sleep(2)  # Wait for 2 seconds

        # Now call the /start-server endpoint
        import requests
        response = requests.get("http://127.0.0.1:8001/start-server")
        return JsonResponse(response.json())
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)

@require_http_methods(["GET"])
def get_captured_data(request):
    """Retrieve all captured data from Firebase."""
    try:
        ref = db.reference(f'/data')
        data = ref.get()
        if not data:
            return JsonResponse({"error": "No data found"}, status=404)

        # Format the data for the doctor's frontend
        formatted_data = {
            "temperature": data.get("temperature"),
            "weight": data.get("weight"),
            # Add any other relevant data here
        }
        
        return JsonResponse({"data": formatted_data})
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)