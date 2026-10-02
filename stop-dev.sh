#!/bin/bash
# Stop THIS project's dev servers. Only the listeners on our two ports are
# signalled, so browsers, other projects' servers, and postgres are untouched.
# Usage: ./stop-dev.sh [vite_port] [server_port]
DEV_PORT=${1:-5180}
SERVER_PORT=${2:-3010}

lsof -iTCP:"$DEV_PORT" -iTCP:"$SERVER_PORT" -sTCP:LISTEN -t 2>/dev/null | xargs kill 2>/dev/null
echo "Dev servers stopped (ports $DEV_PORT, $SERVER_PORT)"
