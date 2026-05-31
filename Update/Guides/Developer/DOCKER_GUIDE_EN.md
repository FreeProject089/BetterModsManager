# Docker Guide for BMM Lightweight Server

This guide explains how to launch a BMM repository server using Docker.

## Prerequisites

- Docker installed on your system (Linux or Windows)
- A generated repository with Docker support enabled

## Generating a Docker-Ready Repository

1. In BMM, go to the **Repository** tab
2. Enable **"Compress as .ZIP archive"** if you want a ZIP file
3. In the **Standalone Server Settings** section:
   - Check **"Docker Support"**
   - Select your host type:
     - **Linux Host** for Linux-based Docker installations
     - **Windows Host** for Windows-based Docker installations
4. Set your desired port (default: 8000)
5. Click **Export** to generate the repository

The generated folder/ZIP will contain:
- `Dockerfile` - Docker image configuration
- `docker-compose.yml` - Docker Compose configuration
- `BMM-Standalone-Server.bat` (Windows) or `BMM-Standalone-Server.sh` (Linux) - Standalone scripts
- `mods/` - Mod files
- `repo.json` - Repository configuration

## Launching with Docker

### Option 1: Using Docker Compose (Recommended)

1. Navigate to the generated repository folder
2. Run:
   ```bash
   docker-compose up -d
   ```

This will:
- Build the Docker image
- Start the container in detached mode
- Expose the configured port
- Mount the repository files as volumes

### Option 2: Using Docker Build and Run

1. Navigate to the generated repository folder
2. Build the image:
   ```bash
   docker build -t bmm-repo-server .
   ```
3. Run the container:
   ```bash
   docker run -d -p 8000:8000 --name bmm-server bmm-repo-server
   ```

Replace `8000` with your configured port if different.

## Accessing the Server

Once the container is running:

- **Repository URL**: `http://localhost:8000/repo.json`
- **Admin Dashboard**: `http://localhost:8000/dashboard`

Use the admin password you set during generation (default: `admin`).

## Managing the Container

### View Logs
```bash
docker-compose logs -f
```

### Stop the Server
```bash
docker-compose down
```

### Restart the Server
```bash
docker-compose restart
```

### Update the Repository

1. Stop the container
2. Update the files in the repository folder
3. Restart the container

## Troubleshooting

### Port Already in Use
If you get a port conflict error:
- Change the port in `docker-compose.yml` under the `ports` section
- Or stop the conflicting service

### Permission Issues (Linux)
If you encounter permission errors:
```bash
sudo docker-compose up -d
```

### Container Not Starting
Check the logs:
```bash
docker-compose logs
```

Common issues:
- Missing files (ensure `mods/`, `repo.json`, `Info.json` exist)
- Incorrect port configuration
- Admin password mismatch

## Advanced Configuration

### Custom Port
Edit `docker-compose.yml`:
```yaml
ports:
  - "YOUR_PORT:YOUR_PORT"
```

### Volume Mounts
The docker-compose.yml already mounts:
- `mods/` - Mod files (read-only)
- `repo.json` - Repository config (read-only)
- `bans.json` - Ban list (read-only)
- `whitelist.json` - Whitelist (read-only)
- `server.log` - Server logs (read-write)
- `history.json` - Download history (read-write)

### Environment Variables
You can set the admin password via environment:
```yaml
environment:
  - ADMIN_PASSWORD=your_password
  - PORT=8000
```

## Windows-Specific Notes

When using Windows containers:
- Ensure Docker Desktop is running in Windows container mode
- The generated Dockerfile uses Windows Nano Server base image
- Some Linux-specific features may not be available

## Linux-Specific Notes

When using Linux containers:
- The generated Dockerfile uses Alpine Linux base image
- Includes `dumb-init` for proper signal handling
- Runs as non-root user for security

## Security Recommendations

1. Change the default admin password
2. Use a firewall to restrict access
3. Consider using Cloudflare Tunnel for public access
4. Regularly update Docker images
5. Don't expose the admin dashboard publicly

## Support

For issues or questions:
- Check the BMM documentation
- Review Docker logs
- Ensure all required files are present
