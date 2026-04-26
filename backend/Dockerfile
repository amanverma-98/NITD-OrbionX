FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create models store directory
RUN mkdir -p models_store

# Train ML model on build
RUN python ai_models/train_model.py

# Expose port
EXPOSE 8000

# Run application
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port $PORT"]
