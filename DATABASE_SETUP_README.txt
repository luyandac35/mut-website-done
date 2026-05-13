MUT ICT WEBSITE - DATABASE LOGIN/REGISTER FIX

1. Open this folder in VS Code.
2. Open terminal in this folder.
3. Run:
   npm install
   node server.js

4. Open browser:
   http://localhost:4000/index.html

LOGIN/REGISTER PAGES ADDED:
- http://localhost:4000/register.html
- http://localhost:4000/login.html

DATABASE OPTION 1: MySQL
1. Open phpMyAdmin or MySQL Workbench.
2. Run the file: database.sql
3. Start the server again with:
   node server.js

Default MySQL settings used by server.js:
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=empty
DB_NAME=mut_website

If MySQL is not running, the website will still work using local-users.json fallback.

WHAT WAS FIXED:
- Added login page
- Added register page
- Added database backend routes: /api/register and /api/login
- Added MySQL users table support
- Added fallback local JSON database so project still works without MySQL
- Kept chatbot working
- Kept smart search working
- Kept cookies working
- Kept WebSocket notices working
- Added Login/Register links to navigation
