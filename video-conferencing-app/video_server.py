import os
import json
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from typing import List
import uvicorn

# Initialize FastAPI with CORS
app = FastAPI()

# CORS Configuration (adjust origins as needed)
origins = [
    "http://localhost:3000",
    "http://192.168.2.180:3001",
    "http://localhost:3001",
    "https://your-render-app.onrender.com"  # Add your production frontend URL
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static Files Setup
static_dir = os.path.abspath("static")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Firebase Config Endpoint
@app.get("/firebase-config")
async def get_firebase_config():
    try:
        config_json = os.getenv("FIREBASE_CONFIG")
        if not config_json:
            raise ValueError("FIREBASE_CONFIG environment variable not set")
        return JSONResponse(content=json.loads(config_json))
    except Exception as e:
        return JSONResponse(
            content={"error": f"Failed to load Firebase config: {str(e)}"},
            status_code=500
        )

# TURN Credentials Endpoint
@app.get("/api/turn-credentials")
async def get_turn_credentials(request: Request):
    try:
        METERED_API_KEY = os.getenv("METERED_API_KEY")
        if not METERED_API_KEY:
            raise ValueError("METERED_API_KEY not configured")

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"https://metered.ca/api/v1/turn/credentials?apiKey={METERED_API_KEY}&lifetime=3600",
                timeout=10.0
            )
            response.raise_for_status()
            return JSONResponse(content=response.json())
    except Exception as e:
        print(f"TURN credentials error: {e}")
        return JSONResponse(
            content={"error": "Failed to fetch TURN credentials"},
            status_code=500
        )

# WebSocket Manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: str, sender: WebSocket):
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except:
                    self.disconnect(connection)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# Root Endpoint
@app.get("/", response_class=HTMLResponse)
async def read_index():
    try:
        with open(os.path.join(static_dir, "index.html")) as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Index file not found</h1>", status_code=404)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("video_server:app", host="0.0.0.0", port=port)