import os
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from server.connection_manager import ConnectionManager

def create_app():
    app = FastAPI()

    @app.get("/")
    async def root():
        return {"message": "FastAPI server is running"}

    return app