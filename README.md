# Edge AI IoT Security Center

## Overview

The Edge AI IoT Security Center is a comprehensive web application designed to monitor IoT devices on a local network, detect anomalies using simulated edge AI capabilities, and provide administrators with complete control through an intuitive dashboard. The application simulates a security monitoring system that automatically identifies new devices, analyzes network traffic patterns, detects suspicious behavior, and quarantines potentially compromised devices.

**Core Functionality:**
- Real-time IoT device monitoring and identification
- Automated anomaly detection with configurable sensitivity levels
- Device lifecycle management (discovery, approval, monitoring, quarantine)
- Comprehensive alerting system for security events
- Audit logging for all administrative actions
- Network traffic visualization and analysis

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework:** React 18 with TypeScript using Vite as the build tool

**Routing:** Wouter - a lightweight routing library chosen for its minimal footprint and simple API, suitable for single-page applications with straightforward routing needs.

**State Management:**
- **TanStack Query (React Query):** Handles all server state management, caching, and data synchronization. Provides automatic background refetching and optimistic updates for a responsive user experience.
- **React Context:** Used for global application state including authentication, theme preferences, and user settings. Three primary contexts:
  - `AuthContext`: Manages user authentication state and login/logout operations
  - `ThemeContext`: Controls light/dark mode with localStorage persistence
  - `SettingsContext`: Stores user preferences like anomaly sensitivity and refresh intervals

**UI Component Library:** shadcn/ui (based on Radix UI primitives) - provides accessible, customizable components following the "New York" style variant. Components are copied into the project rather than installed as dependencies, allowing full customization.

**Design System:** IBM Carbon Design System principles adapted for IoT security monitoring. Key decisions:
- **Typography:** IBM Plex Sans for general UI, IBM Plex Mono for data/metrics to improve numerical readability
- **Color Scheme:** Custom status color system with semantic meaning (normal, suspicious, danger, blocked, pending) implemented via CSS custom properties for both light and dark modes
- **Layout:** Dense information display with functional minimalism - prioritizes data scannability over aesthetics
- **Spacing:** Consistent Tailwind spacing units (2, 4, 6, 8) throughout the application

**Data Visualization:** Recharts library for rendering network traffic charts and protocol distribution visualizations, chosen for its React-native approach and good TypeScript support.

**Form Handling:** React Hook Form with Zod validation via @hookform/resolvers for type-safe form management.

### Backend Architecture

**Framework:** Express.js with TypeScript running on Node.js

**Architecture Pattern:** Monolithic structure with clear separation of concerns:
- **Routes Layer** (`server/routes.ts`): REST API endpoints grouped by feature area (auth, dashboard, devices, alerts, quarantine, logs, traffic)
- **Storage Layer** (`server/storage.ts`): Abstract interface defining all data operations, enabling easy swapping of storage implementations
- **Static Serving** (`server/static.ts`): Serves built frontend assets and handles SPA fallback routing

**In-Memory Storage Implementation:** Currently uses an in-memory storage implementation with mock data for demonstration purposes. The storage interface is designed to be easily replaced with a database-backed implementation without changing route handlers.

**API Design:**
- RESTful conventions with JSON request/response bodies
- Consistent error handling with appropriate HTTP status codes
- Query parameter support for filtering (e.g., severity, status filters)
- Mutation endpoints follow POST/PUT/DELETE patterns

**Session Management:** Built-in preparation for session-based authentication using express-session (referenced in package.json), though currently uses simplified credential checking for demo purposes.

### Data Storage Solutions

**Current State:** In-memory storage with mocked datasets, suitable for demonstration and development.

**Schema Design:** Type-safe schemas defined in `shared/schema.ts` using Zod for runtime validation:
- **Device Schema:** Tracks device identity, network information, status, and traffic metrics
- **Alert Schema:** Records anomaly detections with severity levels and resolution status
- **Quarantine Record Schema:** Manages isolated devices with quarantine reasons and timestamps
- **Log Entry Schema:** Audit trail for all system events
- **Traffic Data:** Time-series data for network traffic visualization

**Database Preparation:** Infrastructure configured for PostgreSQL via Drizzle ORM:
- Drizzle configuration present in `drizzle.config.ts`
- Schema types are Zod-based and can be converted to Drizzle schemas
- Migration directory structure established
- Neon serverless PostgreSQL driver included in dependencies

**Design Rationale:** The separation between Zod schemas and potential database schemas allows the application to validate data at runtime while maintaining the flexibility to add persistence later. The storage interface abstraction means database integration can be added without touching route handlers.

### Authentication and Authorization

**Current Implementation:** Simplified demo authentication with hardcoded credentials (admin@iot.local / admin123)

**Authentication Flow:**
1. User submits credentials via login form
2. Backend validates against demo credentials
3. On success, user object stored in localStorage and AuthContext
4. Protected routes check authentication state before rendering
5. Logout clears localStorage and context state

**Security Considerations (for production):**
- Password hashing should be implemented (bcrypt recommended)
- Session management via express-session and connect-pg-simple
- CSRF protection for state-changing operations
- Rate limiting for login attempts
- Secure cookie configuration with httpOnly and secure flags

**Authorization Model:** Single admin role with full access to all features. The architecture supports role-based expansion through the user object structure.

### External Dependencies

**Core Framework Dependencies:**
- **React Ecosystem:** react@18, react-dom, react-router-alternative (wouter)
- **Build Tools:** Vite for development server and production builds, TypeScript for type safety
- **Backend:** Express.js for HTTP server, Node.js runtime

**UI and Styling:**
- **Tailwind CSS:** Utility-first styling with custom configuration for design system colors
- **Radix UI:** Headless component primitives (@radix-ui/* packages) providing accessibility features
- **shadcn/ui:** Pre-styled components built on Radix primitives
- **class-variance-authority:** Type-safe CSS class composition for component variants
- **Lucide React:** Icon library with consistent design language

**Data Management:**
- **TanStack Query:** Server state management, caching, and synchronization
- **Zod:** Schema validation for runtime type checking
- **date-fns:** Date manipulation and formatting

**Data Visualization:**
- **Recharts:** React-based charting library for traffic visualization

**Database and ORM (prepared but not actively used):**
- **Drizzle ORM:** Type-safe ORM for PostgreSQL
- **@neondatabase/serverless:** PostgreSQL driver optimized for serverless environments
- **drizzle-zod:** Converts Drizzle schemas to Zod validators

**Development Tools:**
- **Replit Plugins:** Development tooling for Replit environment (vite plugins for cartographer, dev banner, runtime error overlay)
- **PostCSS & Autoprefixer:** CSS processing pipeline

**Session and Security (configured but not fully implemented):**
- **express-session:** Session middleware
- **connect-pg-simple:** PostgreSQL-backed session store

**Build Process:** 
- Client built with Vite to `dist/public`
- Server bundled with esbuild to `dist/index.cjs` with selective dependency bundling
- Development mode runs TypeScript directly via tsx