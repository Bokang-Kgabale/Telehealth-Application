import os
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from typing import List

app = FastAPI()

# Define the static directory
static_dir = os.path.abspath("static")

# Mount the static folder for serving HTML, CSS, and JS files
app.mount("/static", StaticFiles(directory=static_dir), name="static")

# Removed: Mount the config directory
# app.mount("/config", StaticFiles(directory="config"), name="config")

@app.get("/", response_class=HTMLResponse)
async def read_index():
    try:
        with open(os.path.join(static_dir, "index.html")) as f:
            return HTMLResponse(content=f.read())
    except FileNotFoundError:
        return HTMLResponse(content="<h1>Index file not found</h1>", status_code=404)

@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return HTMLResponse(content="", status_code=204)

# ✅ Serve firebaseConfig.json from environment variable
@app.get("/firebase-config")
async def get_firebase_config():
    try:
        config_json = os.getenv("FIREBASE_CONFIG")
        return JSONResponse(content=json.loads(config_json))
    except Exception as e:
        return JSONResponse(content={"error": f"Failed to load Firebase config: {str(e)}"}, status_code=500)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        print(f"New connection: {websocket.client}")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            print(f"Disconnected: {websocket.client}")

    async def broadcast(self, message: str, sender: WebSocket):
        for connection in self.active_connections:
            if connection != sender:
                try:
                    await connection.send_text(message)
                except Exception as e:
                    print(f"Error sending message to {connection.client}: {e}")
                    self.disconnect(connection)

manager = ConnectionManager()

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    print("WebSocket connection established.")
    try:
        while True:
            data = await websocket.receive_text()
            print(f"Received message: {data} from {websocket.client}")
            await manager.broadcast(data, websocket)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        print(f"Client disconnected: {websocket.client}")
    except Exception as e:
        print(f"Unexpected error: {e}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("video_server:app", host="0.0.0.0", port=port)
