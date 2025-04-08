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
"""
URL configuration for sample_app_project project.
"""

from django.urls import path
from .views import upload_image, get_captured_data, start_live_stream

urlpatterns = [
    path("api/upload/", upload_image, name="upload_image"),
    path("api/get-data/", get_captured_data, name="get_captured_data"),  
    path("api/start-stream/", start_live_stream, name="start_live_stream"),
]

