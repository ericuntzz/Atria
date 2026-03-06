import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import compare, analyze

load_dotenv()

app = FastAPI(
    title="The Eye - Vision Service",
    description="AI-powered visual intelligence for luxury property inspections",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGINS", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(compare.router, prefix="/api/vision")
app.include_router(analyze.router, prefix="/api/vision")


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "service": "the-eye-vision",
    }
