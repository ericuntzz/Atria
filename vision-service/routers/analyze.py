from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.claude_vision import analyze_property_images

router = APIRouter()


class AnalyzePropertyRequest(BaseModel):
    image_urls: list[str]
    property_name: str | None = None
    property_notes: str | None = None


class ItemInfo(BaseModel):
    name: str
    category: str
    description: str | None = None
    condition: str = "good"
    importance: str = "normal"


class RoomInfo(BaseModel):
    name: str
    room_type: str
    description: str | None = None
    image_urls: list[str] = []
    items: list[ItemInfo] = []


class AnalyzePropertyResponse(BaseModel):
    rooms: list[RoomInfo]


@router.post("/analyze-property", response_model=AnalyzePropertyResponse)
async def analyze_property(request: AnalyzePropertyRequest):
    """Analyze property images to identify rooms and items."""
    try:
        result = await analyze_property_images(
            image_urls=request.image_urls,
            property_name=request.property_name,
            property_notes=request.property_notes,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
