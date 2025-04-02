"""
URL configuration for sample_app_project project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.1/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.urls import path
from .views import start_live_stream, upload_image, save_captured_data, get_captured_data

urlpatterns = [
    path("start-live-stream/", start_live_stream, name="start-live-stream"),
    path("api/upload/", upload_image, name="upload_image"),
    path('api/save-data/', save_captured_data, name='save_captured_data'),
    path('api/get-data/<str:room_id>/', get_captured_data, name='get_captured_data'),
]


