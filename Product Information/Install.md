# D011DL Application Installation Guide

This guide provides step-by-step instructions to deploy and run the D011DL application suite.

---

## 1. Prerequisites

Before you begin, ensure you have the following software installed and running on your host machine:

- **Docker and Docker Compose**: The application is fully containerized. For this next step, you must have Docker installed and running.
- **PostgreSQL**: An external PostgreSQL server is required for data persistence.
- **Git**: For cloning the repository and its contents.
- **A NAS or local directory**: A storage location that will be mounted into the containers to store the downloaded models.

---

## 2. Database Setup

The application requires a dedicated PostgreSQL database and user. A bootstrap script is provided to automate this process.

### Step 2.1: Configure the Bootstrap Script

The script `db/bootstrap.sql` uses `psql` variables. You can either edit the script to replace the placeholders or define them using `psql`'s `-v` flag.

The placeholders are:
- `:DB_NAME`: The name for the application database (e.g., `d011dl`).
- `:DB_USER`: The username for the application to connect with (e.g., `d011dl_app`).
- `:DB_PASS`: The password for the new user. **Ensure this is a strong, secure password.**

### Step 2.2: Run the Bootstrap Script

1.  Open a terminal and connect to your PostgreSQL server as a superuser (like `postgres`).
2.  Execute the script using the following command, replacing the placeholders with your desired values.

    ```bash
    psql -U postgres -f /path/to/your/repo/db/bootstrap.sql \
      -v DB_NAME="d011dl" \
      -v DB_USER="d011dl_app" \
      -v DB_PASS="'YourSecurePasswordHere'"
    ```

    > **Note:** Ensure the path to the `bootstrap.sql` file is correct. The password should be enclosed in single quotes within the double quotes.

3.  This script will create the database, a new user, all required tables, and grant the necessary permissions.

---

## 3. Application Configuration

The application uses a central `.env` file to manage environment variables for all services.

### Step 3.1: Create the .env File

In the root directory of the project, you will find several `.env.example` files. A master `.env` file is required at the root.

1.  Create a new file named `.env` in the project's root directory.
2.  Copy the contents from `api/.env.example` and `web/.env.example` into your new `.env` file. You can consolidate them. It should look like this:

    ```env
    # API
    PORT_API=32002
    JWT_SECRET=replace_this_with_a_long_random_string
    BCRYPT_ROUNDS=12
    STORAGE_ROOT=/media/models/models
    HF_TOKEN=

    # DB
    PGHOST=your_postgres_host_ip
    PGPORT=5432
    PGDATABASE=d011dl
    PGUSER=d011dl_app
    PGPASSWORD=YourSecurePasswordHere
    PGSSLMODE=disable

    # WEB
    PORT_WEB=32001
    API_BASE_INTERNAL=http://api:32002
    SESSION_SECRET=replace_this_with_another_secret_string
    ```

### Step 3.2: Edit the Environment Variables

- **`JWT_SECRET`**: Replace with a long, random, and secret string for signing session tokens.
- **`STORAGE_ROOT`**: **This is important.** Set this to the absolute path on your *host machine* where you want to store the models. This directory will be bind-mounted into the containers. For example: `/mnt/nas/huggingface_models`. The application will create a `models` subdirectory within this path.
- **`PGHOST`**: The IP address or hostname of your PostgreSQL server.
- **`PGDATABASE`**: The database name you chose in Step 2.2.
- **`PGUSER`**: The database user you created in Step 2.2.
- **`PGPASSWORD`**: The password you set for the database user in Step 2.2.
- **`SESSION_SECRET`**: Another secret string used for the web portal's session management.

---

## 4. Build and Run the Application

With the database and configuration in place, you can now launch the application using Docker Compose.

### Step 4.1: Create Host Mount Point

Ensure the directory you specified for `STORAGE_ROOT` in the `.env` file exists on the host machine. The `docker-compose.yml` file references `/media/models`, so you should either use that path or update the `volumes` section in `docker-compose.yml` to match your `STORAGE_ROOT`'s parent directory.

For example, if `STORAGE_ROOT=/data/models`, the volume mount in `docker-compose.yml` should be `- /data:/media/models`. By default, it expects `/media/models` to exist on the host.

### Step 4.2: Launch Containers

1.  Open a terminal in the root directory of the project.
2.  Run the following command to build the container images and start the services in the background:

    ```bash
    docker-compose up -d --build
    ```

3.  The first build may take a few minutes as it needs to download base images and install dependencies.

### Step 4.3: Verify Installation

1.  Check if the containers are running:
    ```bash
    docker-compose ps
    ```
    You should see two services, `api` and `web`, with a status of `Up`.

2.  Access the Web Portal by navigating to `http://localhost:32001` in your web browser.

3.  You can now register a new user and log in to start using the application.

---

## 5. Stopping the Application

To stop the running containers, execute the following command from the project's root directory:

```bash
docker-compose down
```
