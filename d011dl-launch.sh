#!/bin/bash

# Turn down containers
echo "Turning Containers down"
docker-compose down

# Pulling from Repo
echo "Pulling from rpo"
git pull

# Build the new code
echo "Build the newly downloaded code"
docker-compose build

# Re-Launch the container with the new code
echo "Launching Container"
docker-compose up -d

echo "Update complete."
docker ps
