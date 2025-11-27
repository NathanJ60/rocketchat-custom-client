#!/bin/bash

# Configuration
ROCKETCHAT_URL="http://localhost:3001"
ADMIN_USER="testadmin"
ADMIN_PASS="admin123"
ADMIN_EMAIL="admin@test.com"
CHANNEL_NAME="test"

echo "=========================================="
echo "  Rocket.Chat Initialization Script"
echo "=========================================="

# Wait for Rocket.Chat to be ready
echo "[1/5] Waiting for Rocket.Chat to start..."
until curl -s "$ROCKETCHAT_URL/api/info" > /dev/null 2>&1; do
    echo "   Waiting... (this can take 1-2 minutes)"
    sleep 5
done
echo "   Rocket.Chat is UP!"

# Register admin user
echo "[2/5] Registering admin user..."
REGISTER_RESPONSE=$(curl -s -X POST "$ROCKETCHAT_URL/api/v1/users.register" \
    -H "Content-Type: application/json" \
    -d "{
        \"username\": \"$ADMIN_USER\",
        \"email\": \"$ADMIN_EMAIL\",
        \"pass\": \"$ADMIN_PASS\",
        \"name\": \"Administrator\"
    }")

if echo "$REGISTER_RESPONSE" | grep -q '"success":true'; then
    echo "   Admin user created successfully!"
else
    echo "   Admin user might already exist or registration failed"
    echo "   Response: $REGISTER_RESPONSE"
fi

# Login to get auth token
echo "[3/5] Logging in..."
LOGIN_RESPONSE=$(curl -s -X POST "$ROCKETCHAT_URL/api/v1/login" \
    -H "Content-Type: application/json" \
    -d "{
        \"user\": \"$ADMIN_USER\",
        \"password\": \"$ADMIN_PASS\"
    }")

AUTH_TOKEN=$(echo "$LOGIN_RESPONSE" | grep -o '"authToken":"[^"]*"' | cut -d'"' -f4)
USER_ID=$(echo "$LOGIN_RESPONSE" | grep -o '"userId":"[^"]*"' | cut -d'"' -f4)

if [ -z "$AUTH_TOKEN" ] || [ -z "$USER_ID" ]; then
    echo "   ERROR: Failed to login!"
    echo "   Response: $LOGIN_RESPONSE"
    exit 1
fi
echo "   Login successful!"

# Create test channel
echo "[4/5] Creating #$CHANNEL_NAME channel..."
CHANNEL_RESPONSE=$(curl -s -X POST "$ROCKETCHAT_URL/api/v1/channels.create" \
    -H "Content-Type: application/json" \
    -H "X-Auth-Token: $AUTH_TOKEN" \
    -H "X-User-Id: $USER_ID" \
    -d "{\"name\": \"$CHANNEL_NAME\"}")

CHANNEL_ID=$(echo "$CHANNEL_RESPONSE" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

if echo "$CHANNEL_RESPONSE" | grep -q '"success":true'; then
    echo "   Channel #$CHANNEL_NAME created! ID: $CHANNEL_ID"
else
    echo "   Channel might already exist"
    # Try to get existing channel ID
    CHANNEL_INFO=$(curl -s -X GET "$ROCKETCHAT_URL/api/v1/channels.info?roomName=$CHANNEL_NAME" \
        -H "X-Auth-Token: $AUTH_TOKEN" \
        -H "X-User-Id: $USER_ID")
    CHANNEL_ID=$(echo "$CHANNEL_INFO" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "   Existing channel ID: $CHANNEL_ID"
fi

# Get GENERAL room ID
echo "[5/5] Getting GENERAL room info..."
GENERAL_INFO=$(curl -s -X GET "$ROCKETCHAT_URL/api/v1/channels.info?roomName=general" \
    -H "X-Auth-Token: $AUTH_TOKEN" \
    -H "X-User-Id: $USER_ID")
GENERAL_ID=$(echo "$GENERAL_INFO" | grep -o '"_id":"[^"]*"' | head -1 | cut -d'"' -f4)

echo ""
echo "=========================================="
echo "  INITIALIZATION COMPLETE!"
echo "=========================================="
echo ""
echo "  Admin Credentials:"
echo "    Username: $ADMIN_USER"
echo "    Password: $ADMIN_PASS"
echo "    Email:    $ADMIN_EMAIL"
echo ""
echo "  Auth Token: $AUTH_TOKEN"
echo "  User ID:    $USER_ID"
echo ""
echo "  Channels:"
echo "    GENERAL ID: $GENERAL_ID"
echo "    #test ID:   $CHANNEL_ID"
echo ""
echo "  Rocket.Chat URL: $ROCKETCHAT_URL"
echo "=========================================="
