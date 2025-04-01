import sys
print("Python Path:", sys.path)

from fastapi import FastAPI
from server.app import create_app
import uvicorn

app = FastAPI()

@app.get("/start-server")
async def start_server():
    return {"message": "Server started successfully"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)

