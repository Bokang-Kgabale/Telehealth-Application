import sys
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# Set the path to the vision-key.json file
os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = os.path.abspath("config/vision-key.json")

app = FastAPI()

# Add CORS middleware
origins = [
    "http://localhost:3000",
    "http://192.168.2.180:3001",  # ✅ allow your network frontend
    "http://localhost:3001"       # optional: if you're using localhost:3001 too
]


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/start-server")
async def start_server():
    return {"message": "Server started successfully"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)