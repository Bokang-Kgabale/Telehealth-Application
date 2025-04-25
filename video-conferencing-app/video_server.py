try:
    import os
    import json
    import httpx
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import HTMLResponse, JSONResponse
    from fastapi.middleware.cors import CORSMiddleware
    from typing import List
    import uvicorn
    from dotenv import load_dotenv
except ImportError as e:
    print(f"Missing required package: {e.name}")
    print("Install dependencies with: pip install -r requirements.txt")
    raise

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI with CORS
app = FastAPI()

# CORS Configuration (adjust origins as needed)
origins = [
    "http://localhost:3000",
    "http://192.168.2.180:3001",
    "http://localhost:3001",
    "https://telehealth-application.onrender.com"  # Add your production frontend URL
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

# TURN Credentials Endpoint with enhanced logging
@app.get("/api/turn-credentials")
async def get_turn_credentials(request: Request):
    try:
        METERED_API_KEY = os.getenv("METERED_API_KEY")
        print(f"METERED_API_KEY configured: {'Yes' if METERED_API_KEY else 'No'}")
        
        if not METERED_API_KEY:
            raise ValueError("METERED_API_KEY not configured")

        url = f"https://www.metered.ca/api/v1/turn/credentials?apiKey={METERED_API_KEY}&lifetime=3600"
        print(f"Requesting TURN credentials from: {url}")
        
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(
                    url, 
                    timeout=10.0,
                    follow_redirects=True  # Explicitly enable redirect following
                )
                print(f"Metered.ca response status: {response.status_code}")
                response.raise_for_status()
                result = response.json()
                print("Successfully received TURN credentials")
                return JSONResponse(content=result)
            except httpx.HTTPStatusError as e:
                print(f"HTTP status error: {e.response.status_code}, {await e.response.text()}")
                raise
            except Exception as e:
                print(f"Request error: {type(e).__name__}: {str(e)}")
                raise
    except Exception as e:
        print(f"TURN credentials error: {type(e).__name__}: {str(e)}")
        return JSONResponse(
            content={"error": f"Failed to fetch TURN credentials: {str(e)}"},
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

# Health check endpoint
@app.get("/health")
async def health_check():
    return {"status": "ok"}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("app:app", host="0.0.0.0", port=port, reload=True)