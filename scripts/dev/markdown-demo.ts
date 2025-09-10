import React from "react";
import { render } from "ink";
import { renderMarkdown } from "../../source/markdown.tsx";

const demoMarkdown = `# Markdown Rendering Demo

This demonstrates all the **beautiful** markdown rendering features with *aesthetic* terminal output.

## Headings at Different Levels

### Third Level Heading
#### Fourth Level Heading
##### Fifth Level Heading
###### Sixth Level Heading

## Text Formatting

Here's some **bold text** and *italic text* and ~~strikethrough text~~.

You can also have **bold with *nested italic* text** for complex formatting.

## Code Examples

Inline code like \`npm install\`, \`import React from 'react'\`, and \`const API_KEY = 'secret'\` is highlighted with inverse colors.

### JavaScript & TypeScript

\`\`\`javascript
// Modern JavaScript with async/await and destructuring
const fetchUserData = async (userId) => {
  try {
    const response = await fetch(\`/api/users/\${userId}\`);
    const { data, errors } = await response.json();
    
    if (errors?.length > 0) {
      throw new Error(\`API Error: \${errors[0].message}\`);
    }
    
    return data;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    return null;
  }
};

// Class with private fields and methods
class UserManager {
  #users = new Map();
  
  constructor(apiClient) {
    this.apiClient = apiClient;
  }
  
  async #validateUser(userData) {
    const schema = { name: 'string', email: 'string' };
    return Object.keys(schema).every(key => 
      typeof userData[key] === schema[key]
    );
  }
  
  async addUser(userData) {
    if (await this.#validateUser(userData)) {
      this.#users.set(userData.id, userData);
      return true;
    }
    return false;
  }
}
\`\`\`

\`\`\`typescript
// TypeScript with generics, interfaces, and advanced types
interface ApiResponse<T> {
  data: T;
  meta: {
    page: number;
    limit: number;
    total: number;
  };
}

type UserRole = 'admin' | 'user' | 'moderator';

interface User {
  readonly id: string;
  name: string;
  email: string;
  role: UserRole;
  preferences?: {
    theme: 'light' | 'dark';
    notifications: boolean;
  };
}

class ApiClient<T extends Record<string, unknown>> {
  constructor(private baseUrl: string, private token?: string) {}
  
  async get<R>(endpoint: string): Promise<ApiResponse<R>> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: \`Bearer \${this.token}\` })
    };
    
    const response = await fetch(\`\${this.baseUrl}\${endpoint}\`, {
      headers,
      method: 'GET'
    });
    
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status}: \${response.statusText}\`);
    }
    
    return response.json();
  }
}

// Usage with proper typing
const userApi = new ApiClient<User>('https://api.example.com', 'abc123');
const users: ApiResponse<User[]> = await userApi.get('/users');
\`\`\`

### Python with Advanced Features

\`\`\`python
import asyncio
import dataclasses
from typing import List, Optional, Dict, Any, Protocol
from contextlib import asynccontextmanager
from datetime import datetime, timezone

# Data classes and type hints
@dataclasses.dataclass(frozen=True)
class User:
    id: str
    name: str
    email: str
    created_at: datetime = dataclasses.field(default_factory=lambda: datetime.now(timezone.utc))
    
    def __post_init__(self):
        if '@' not in self.email:
            raise ValueError(f"Invalid email: {self.email}")

# Protocol for dependency injection
class DatabaseProtocol(Protocol):
    async def save(self, data: Dict[str, Any]) -> str: ...
    async def find_by_id(self, id: str) -> Optional[Dict[str, Any]]: ...

# Async context manager and decorators
class UserService:
    def __init__(self, db: DatabaseProtocol):
        self._db = db
        self._cache: Dict[str, User] = {}
    
    @asynccontextmanager
    async def transaction(self):
        """Context manager for database transactions"""
        try:
            await self._db.begin_transaction()
            yield
            await self._db.commit()
        except Exception as e:
            await self._db.rollback()
            raise e
    
    async def create_user(self, name: str, email: str) -> User:
        user = User(id=f"user_{len(self._cache)}", name=name, email=email)
        
        async with self.transaction():
            user_id = await self._db.save({
                'name': user.name,
                'email': user.email,
                'created_at': user.created_at.isoformat()
            })
            
        self._cache[user_id] = user
        return user

# List comprehension and generator expressions
def process_data(items: List[Dict[str, Any]]) -> List[str]:
    # Filter, transform, and extract with comprehensions
    valid_items = [item for item in items if item.get('status') == 'active']
    processed = [f"{item['name'].upper()}_{item['id']}" for item in valid_items]
    
    # Generator for memory efficiency
    def batch_generator(data, batch_size=10):
        for i in range(0, len(data), batch_size):
            yield data[i:i + batch_size]
    
    return [item for batch in batch_generator(processed) for item in batch]

# Async main function
async def main():
    db = MockDatabase()  # Implements DatabaseProtocol
    service = UserService(db)
    
    users = await asyncio.gather(*[
        service.create_user(f"User {i}", f"user{i}@example.com")
        for i in range(5)
    ])
    
    print(f"Created {len(users)} users successfully!")

if __name__ == "__main__":
    asyncio.run(main())
\`\`\`

### Rust with Ownership and Traits

\`\`\`rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::sync::RwLock;
use serde::{Deserialize, Serialize};

// Traits and generics
trait Repository<T> {
    async fn save(&self, item: &T) -> Result<String, Box<dyn std::error::Error>>;
    async fn find_by_id(&self, id: &str) -> Option<T>;
}

// Derive macros and attributes
#[derive(Debug, Clone, Serialize, Deserialize)]
struct User {
    id: String,
    name: String,
    email: String,
    #[serde(with = "chrono::serde::ts_seconds")]
    created_at: chrono::DateTime<chrono::Utc>,
}

// Generic struct with lifetime parameters
#[derive(Debug)]
struct UserService<'a, R: Repository<User>> {
    repository: &'a R,
    cache: Arc<RwLock<HashMap<String, User>>>,
}

impl<'a, R: Repository<User>> UserService<'a, R> {
    fn new(repository: &'a R) -> Self {
        Self {
            repository,
            cache: Arc::new(RwLock::new(HashMap::new())),
        }
    }
    
    async fn create_user(&self, name: String, email: String) -> Result<User, Box<dyn std::error::Error>> {
        let user = User {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.clone(),
            email: email.clone(),
            created_at: chrono::Utc::now(),
        };
        
        // Save to repository
        let user_id = self.repository.save(&user).await?;
        
        // Update cache
        let mut cache = self.cache.write().await;
        cache.insert(user_id, user.clone());
        
        Ok(user)
    }
}

// Pattern matching and error handling
fn parse_config(input: &str) -> Result<HashMap<String, String>, &'static str> {
    let mut config = HashMap::new();
    
    for line in input.lines() {
        match line.split_once('=') {
            Some((key, value)) if !key.trim().is_empty() => {
                config.insert(key.trim().to_string(), value.trim().to_string());
            }
            Some(_) => return Err("Invalid key in configuration"),
            None if line.trim().is_empty() => continue,
            None => return Err("Invalid line format"),
        }
    }
    
    Ok(config)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let repo = InMemoryRepository::new();
    let service = UserService::new(&repo);
    
    let user = service.create_user(
        "Alice Johnson".to_string(),
        "alice@example.com".to_string()
    ).await?;
    
    println!("Created user: {:#?}", user);
    Ok(())
}
\`\`\`

### Go with Goroutines and Interfaces

\`\`\`go
package main

import (
    "context"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "sync"
    "time"
)

// Interfaces for dependency injection
type UserRepository interface {
    Save(ctx context.Context, user *User) error
    FindByID(ctx context.Context, id string) (*User, error)
}

type Cache interface {
    Set(key string, value interface{}, ttl time.Duration) error
    Get(key string) (interface{}, bool)
}

// Struct with JSON tags
type User struct {
    ID        string    \`json:"id" db:"id"\`
    Name      string    \`json:"name" db:"name" validate:"required"\`
    Email     string    \`json:"email" db:"email" validate:"required,email"\`
    CreatedAt time.Time \`json:"created_at" db:"created_at"\`
}

// Service with embedded interfaces
type UserService struct {
    repo  UserRepository
    cache Cache
    mu    sync.RWMutex
    stats map[string]int
}

func NewUserService(repo UserRepository, cache Cache) *UserService {
    return &UserService{
        repo:  repo,
        cache: cache,
        stats: make(map[string]int),
    }
}

// Method with context and error handling
func (s *UserService) CreateUser(ctx context.Context, name, email string) (*User, error) {
    // Validate input
    if name == "" || email == "" {
        return nil, fmt.Errorf("name and email are required")
    }
    
    user := &User{
        ID:        generateID(),
        Name:      name,
        Email:     email,
        CreatedAt: time.Now().UTC(),
    }
    
    // Save to repository
    if err := s.repo.Save(ctx, user); err != nil {
        return nil, fmt.Errorf("failed to save user: %w", err)
    }
    
    // Cache the user
    cacheKey := fmt.Sprintf("user:%s", user.ID)
    if err := s.cache.Set(cacheKey, user, 1*time.Hour); err != nil {
        log.Printf("Warning: failed to cache user %s: %v", user.ID, err)
    }
    
    // Update stats
    s.mu.Lock()
    s.stats["users_created"]++
    s.mu.Unlock()
    
    return user, nil
}

// HTTP handler with middleware pattern
func (s *UserService) CreateUserHandler(w http.ResponseWriter, r *http.Request) {
    if r.Method != http.MethodPost {
        http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
        return
    }
    
    var req struct {
        Name  string \`json:"name"\`
        Email string \`json:"email"\`
    }
    
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "Invalid JSON", http.StatusBadRequest)
        return
    }
    
    ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
    defer cancel()
    
    user, err := s.CreateUser(ctx, req.Name, req.Email)
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(user)
}

// Goroutine worker pattern
func (s *UserService) StartMetricsWorker(ctx context.Context) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()
    
    for {
        select {
        case <-ctx.Done():
            return
        case <-ticker.C:
            s.mu.RLock()
            stats := make(map[string]int)
            for k, v := range s.stats {
                stats[k] = v
            }
            s.mu.RUnlock()
            
            log.Printf("Metrics: %+v", stats)
        }
    }
}

func main() {
    repo := &InMemoryRepository{}
    cache := &InMemoryCache{}
    service := NewUserService(repo, cache)
    
    ctx, cancel := context.WithCancel(context.Background())
    defer cancel()
    
    // Start background worker
    go service.StartMetricsWorker(ctx)
    
    http.HandleFunc("/users", service.CreateUserHandler)
    
    fmt.Println("Server starting on :8080")
    log.Fatal(http.ListenAndServe(":8080", nil))
}

func generateID() string {
    return fmt.Sprintf("user_%d", time.Now().UnixNano())
}
\`\`\`

### SQL and Database Queries

\`\`\`sql
-- Complex query with CTEs, window functions, and joins
WITH user_stats AS (
    SELECT 
        u.id,
        u.name,
        u.email,
        COUNT(o.id) as order_count,
        SUM(o.total_amount) as total_spent,
        AVG(o.total_amount) as avg_order_value,
        ROW_NUMBER() OVER (ORDER BY SUM(o.total_amount) DESC) as spending_rank
    FROM users u
    LEFT JOIN orders o ON u.id = o.user_id 
    WHERE u.created_at >= '2023-01-01'
    GROUP BY u.id, u.name, u.email
),
top_customers AS (
    SELECT *
    FROM user_stats
    WHERE spending_rank <= 100
)
SELECT 
    tc.name,
    tc.email,
    tc.order_count,
    tc.total_spent,
    tc.avg_order_value,
    CASE 
        WHEN tc.total_spent > 1000 THEN 'VIP'
        WHEN tc.total_spent > 500 THEN 'Premium'
        ELSE 'Standard'
    END as customer_tier,
    -- Calculate percentile
    PERCENT_RANK() OVER (ORDER BY tc.total_spent) * 100 as spending_percentile
FROM top_customers tc
ORDER BY tc.total_spent DESC;

-- Advanced indexing and constraints
CREATE INDEX CONCURRENTLY idx_users_email_active 
ON users (email) 
WHERE status = 'active';

CREATE UNIQUE INDEX idx_users_external_id 
ON users (external_id) 
WHERE external_id IS NOT NULL;

-- Trigger function for audit logging
CREATE OR REPLACE FUNCTION audit_user_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        INSERT INTO user_audit_log (
            user_id,
            action,
            old_values,
            new_values,
            changed_by,
            changed_at
        ) VALUES (
            NEW.id,
            'UPDATE',
            row_to_json(OLD),
            row_to_json(NEW),
            current_user,
            now()
        );
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
\`\`\`

### Shell Scripts and DevOps

\`\`\`bash
#!/bin/bash
set -euo pipefail  # Exit on error, undefined vars, pipe failures

# Color codes for output
readonly RED='\\033[0;31m'
readonly GREEN='\\033[0;32m'
readonly YELLOW='\\033[1;33m'
readonly NC='\\033[0m' # No Color

# Configuration
readonly SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
readonly LOG_FILE="/tmp/deploy-$(date +%Y%m%d-%H%M%S).log"

# Logging functions
log() {
    echo -e "\${GREEN}[INFO]\${NC} $*" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "\${YELLOW}[WARN]\${NC} $*" | tee -a "$LOG_FILE"
}

error() {
    echo -e "\${RED}[ERROR]\${NC} $*" | tee -a "$LOG_FILE"
    exit 1
}

# Cleanup function
cleanup() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Deployment failed! Check log: $LOG_FILE"
    else
        log "Deployment completed successfully!"
    fi
    exit $exit_code
}

trap cleanup EXIT

# Validation functions
check_prerequisites() {
    log "Checking prerequisites..."
    
    local required_tools=("docker" "kubectl" "helm" "jq")
    for tool in "\${required_tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            error "Required tool '$tool' is not installed"
        fi
    done
    
    # Check if we're in the right directory
    if [[ ! -f "$PROJECT_ROOT/package.json" ]]; then
        error "Not in a valid project directory"
    fi
    
    log "Prerequisites check passed"
}

# Build and test
build_application() {
    log "Building application..."
    
    cd "$PROJECT_ROOT"
    
    # Install dependencies if needed
    if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules" ]]; then
        log "Installing dependencies..."
        npm ci --silent
    fi
    
    # Run tests
    log "Running tests..."
    npm run test 2>&1 | tee -a "$LOG_FILE"
    
    # Build the application
    log "Building production bundle..."
    NODE_ENV=production npm run build 2>&1 | tee -a "$LOG_FILE"
    
    # Build Docker image
    local image_tag="myapp:$(git rev-parse --short HEAD)"
    log "Building Docker image: $image_tag"
    
    docker build \\
        --tag "$image_tag" \\
        --build-arg NODE_ENV=production \\
        --build-arg BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')" \\
        --build-arg VCS_REF="$(git rev-parse HEAD)" \\
        . | tee -a "$LOG_FILE"
    
    echo "$image_tag"
}

# Deploy to Kubernetes
deploy_to_k8s() {
    local image_tag="$1"
    local environment="\${2:-staging}"
    
    log "Deploying to Kubernetes environment: $environment"
    
    # Update Helm values
    local values_file="k8s/values-$environment.yaml"
    if [[ ! -f "$values_file" ]]; then
        error "Values file not found: $values_file"
    fi
    
    # Deploy with Helm
    helm upgrade --install \\
        "myapp-$environment" \\
        ./k8s/charts/myapp \\
        --values "$values_file" \\
        --set image.tag="$image_tag" \\
        --set deployment.timestamp="$(date +%s)" \\
        --namespace "$environment" \\
        --create-namespace \\
        --wait \\
        --timeout 10m | tee -a "$LOG_FILE"
    
    # Verify deployment
    log "Verifying deployment..."
    kubectl rollout status deployment/myapp -n "$environment" --timeout=300s
    
    # Run health checks
    local service_url
    service_url=$(kubectl get service myapp -n "$environment" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
    
    if [[ -n "$service_url" ]]; then
        log "Running health check on http://$service_url/health"
        for i in {1..30}; do
            if curl -sf "http://$service_url/health" > /dev/null; then
                log "Health check passed!"
                break
            elif [[ $i -eq 30 ]]; then
                error "Health check failed after 30 attempts"
            else
                warn "Health check attempt $i failed, retrying in 10s..."
                sleep 10
            fi
        done
    fi
}

# Main function
main() {
    local environment="\${1:-staging}"
    
    log "Starting deployment to $environment environment"
    log "Log file: $LOG_FILE"
    
    check_prerequisites
    
    local image_tag
    image_tag=$(build_application)
    
    deploy_to_k8s "$image_tag" "$environment"
    
    log "Deployment pipeline completed successfully!"
    log "Image deployed: $image_tag"
}

# Parse command line arguments
while getopts "e:h" opt; do
    case $opt in
        e)
            ENVIRONMENT="$OPTARG"
            ;;
        h)
            echo "Usage: $0 [-e environment] [-h]"
            echo "  -e: Target environment (default: staging)"
            echo "  -h: Show this help message"
            exit 0
            ;;
        \\?)
            error "Invalid option: -$OPTARG"
            ;;
    esac
done

# Run main function
main "\${ENVIRONMENT:-staging}"
\`\`\`

### JSON and Configuration

\`\`\`json
{
  "name": "comprehensive-demo-app",
  "version": "2.1.0",
  "description": "A comprehensive application showcasing modern development practices",
  "main": "dist/index.js",
  "type": "module",
  "engines": {
    "node": ">=18.0.0",
    "npm": ">=8.0.0"
  },
  "scripts": {
    "dev": "concurrently \\"npm:dev:*\\"",
    "dev:server": "tsx watch src/server.ts",
    "dev:client": "vite",
    "build": "npm run build:client && npm run build:server",
    "build:client": "vite build",
    "build:server": "tsc -p tsconfig.server.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "lint": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write \\"src/**/*.{ts,tsx,json}\\"",
    "start": "node dist/server.js",
    "docker:build": "docker build -t myapp:latest .",
    "docker:run": "docker run -p 3000:3000 myapp:latest"
  },
  "dependencies": {
    "@fastify/cors": "^8.2.0",
    "@fastify/helmet": "^10.1.0",
    "@fastify/rate-limit": "^8.0.0",
    "fastify": "^4.15.0",
    "prisma": "^4.11.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-query": "^3.39.3",
    "react-router-dom": "^6.8.1",
    "zod": "^3.20.6"
  },
  "devDependencies": {
    "@types/node": "^18.15.0",
    "@types/react": "^18.0.28",
    "@types/react-dom": "^18.0.11",
    "@typescript-eslint/eslint-plugin": "^5.54.1",
    "@typescript-eslint/parser": "^5.54.1",
    "@vitejs/plugin-react": "^3.1.0",
    "concurrently": "^7.6.0",
    "eslint": "^8.35.0",
    "eslint-config-prettier": "^8.7.0",
    "prettier": "^2.8.4",
    "tsx": "^3.12.3",
    "typescript": "^4.9.5",
    "vite": "^4.1.4",
    "vitest": "^0.29.2"
  },
  "prisma": {
    "schema": "src/prisma/schema.prisma"
  },
  "prettier": {
    "semi": true,
    "singleQuote": true,
    "tabWidth": 2,
    "trailingComma": "es5"
  },
  "eslintConfig": {
    "extends": [
      "@typescript-eslint/recommended",
      "prettier"
    ],
    "parser": "@typescript-eslint/parser",
    "plugins": ["@typescript-eslint"],
    "rules": {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/explicit-function-return-type": "warn"
    }
  }
}
\`\`\`

### Code Block without Language

\`\`\`
This is plain code without syntax highlighting
but still gets the nice bordered formatting.

It could be pseudocode:
  BEGIN
    IF condition THEN
      EXECUTE action
    ELSE
      EXECUTE alternative
    END IF
  END

Or configuration:
  server.host = localhost
  server.port = 8080
  database.url = postgresql://...
  
Or any other plain text code format.
\`\`\`

## Lists

### Unordered Lists

- First item with **bold** text
- Second item with *italic* text
- Third item with \`inline code\`
  - Nested item one
  - Nested item two
- Fourth item with [a link](https://example.com)

### Ordered Lists

1. First numbered item
2. Second numbered item with **formatting**
3. Third numbered item
   - Mixed with unordered
   - Another nested item
4. Fourth numbered item

### Task Lists

- [ ] Todo item not completed
- [x] Completed task item
- [ ] Another todo with *italic* text
- [x] Done task with **bold** text

## Links and Images

Here's a [link to GitHub](https://github.com) and here's an ![example image](https://example.com/image.png).

You can also have [links with **bold text**](https://example.com/bold) inside them.

## Blockquotes

> This is a blockquote with important information.
> 
> It can span multiple lines and contain **formatted text** and \`code\`.
>
> > Nested blockquotes are also supported
> > with proper indentation.

## Tables

| Feature | Status | Description |
|---------|--------|-------------|
| **Headings** | ✅ | Colorful with different symbols |
| *Formatting* | ✅ | Bold, italic, strikethrough |
| \`Code\` | ✅ | Syntax highlighting boxes |
| Links | ✅ | Blue underlined with URLs |
| Tables | ✅ | Clean borders and formatting |

## Horizontal Rules

Here's some content above.

---

And here's content below the horizontal rule.

## Complex Mixed Content

This section combines multiple elements:

### Example: Setting Up a Project

1. **Initialize** the project:
   \`\`\`bash
   mkdir my-project
   cd my-project
   npm init -y
   \`\`\`

2. **Install** dependencies:
   - Run \`npm install express\` for the web server
   - Run \`npm install --save-dev typescript\` for TypeScript

3. **Create** your main file:
   \`\`\`typescript
   import express from 'express';
   
   const app = express();
   const PORT = process.env.PORT || 3000;
   
   app.get('/', (req, res) => {
     res.json({ message: 'Hello, World!' });
   });
   
   app.listen(PORT, () => {
     console.log(\`Server running on port \${PORT}\`);
   });
   \`\`\`

4. **Configure** TypeScript:
   > Create a \`tsconfig.json\` file with your compiler options.
   > Make sure to set \`"target": "ES2020"\` for modern features.

5. **Deploy** when ready:
   - [ ] Test locally with \`npm start\`
   - [ ] Run tests with \`npm test\`
   - [x] Deploy to production

## Final Notes

This demo shows the **complete range** of markdown rendering capabilities with:

- 🎨 **Beautiful colors** for different element types
- 📦 **Code blocks** with elegant borders
- 📝 **Proper formatting** that's easy to read
- 🔗 **Links** and images with clear indicators
- 📊 **Tables** with clean structure
- 💬 **Blockquotes** with distinctive styling

The output is optimized for terminal display with *great contrast* and **readability**!
`;

console.log("🎨 Markdown Rendering Demo");
console.log("=" .repeat(50));
console.log();

const markdownComponent = renderMarkdown(demoMarkdown);
render(markdownComponent);

console.log("=" .repeat(50));
console.log("✨ Demo complete! All markdown features rendered above.");