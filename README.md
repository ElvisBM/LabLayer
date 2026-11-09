LabLayer
A full-stack application for 3D printing operations, production management, and cost control.

LabLayer is a personal project designed to solve real operational challenges in a 3D printing business. It brings product management, production planning, inventory, pricing, sales, and financial visibility into a single web application.

I use this project to explore practical software architecture, modern frontend development, business rules, integrations, and AI-assisted development workflows.
Project status: Actively developed. Some features and third-party integrations are still being refined. This repository is temporarily available for technical review.

What the application does
- Production management: Plan and follow 3D printing jobs and operational tasks.
- Product catalog: Manage products and their variations.
- Cost calculation and pricing: Estimate material, printing time, equipment, consumable, and operational costs to support pricing decisions.
- Filament and inventory management: Track materials, supplies, and stock.
- Printer management: Keep an overview of the printer fleet and related operational information.
- Orders and sales: Organize orders, quotes, sales, and financial records.
- Marketplace workflows: Support commerce-related processes and integration work with external platforms.
- Reporting: Dashboards for operational and financial visibility.
Tech stack
Area	Technologies
Frontend	React 19, TypeScript, Vite, Tailwind CSS
Backend	Node.js, Express, TypeScript
Authentication and data	Firebase Authentication, Cloud Firestore, Firebase Admin SDK
Integrations	REST APIs, WooCommerce integration, marketplace-related workflows, n8n automation
AI tooling	Google Gemini integration tooling and AI-assisted development workflows
Quality	TypeScript checks, Vitest/Testing Library tooling
Delivery	GitHub Actions, VPS deployment, PM2


Technical highlights
Domain logic and maintainability
Pricing rules are implemented in a dedicated TypeScript utility (src/utils/pricing.ts), separated from the UI. The calculation considers several production inputs, including material usage, printer-related costs, consumables, and operational overhead.

The frontend is organized around reusable components, shared authentication context, utilities, and feature screens. As the project evolves, I am continuing to break down larger screens into smaller, more testable modules.
Data access and security
The application uses Firebase Authentication and Firestore rules for access control and tenant-scoped data. Backend-only operations and administrative routes are implemented through Express and Firebase Admin. Sensitive configuration is intended to be supplied via environment variables and deployment secrets, not committed credentials.
Integrations and automation
The backend includes REST API integration code and workflows involving external commerce services. The repository also contains n8n workflow documentation and examples. Integrations are at different stages of development and should not all be considered production-ready.
Deployment
GitHub Actions workflows support type validation, application builds, and deployment to a VPS. Production process management uses PM2. The project also includes scripts and artifacts for scoped releases.
Repository structure
- src/components/ — Reusable UI components
- src/contexts/ — Shared application context and authentication state
- src/utils/ — Shared business calculations and utilities
- src/views/ — Main product screens and workflows
- server.ts — Express server and API endpoints
- firestore.rules — Firestore authorization and data validation rules
- .github/workflows/ — Build and deployment workflows
- docs/ — API and automation documentation
Running locally
Prerequisites: Node.js 22+, npm, and access to an appropriately configured Firebase project.
1. Install dependencies: npm ci
2. Copy the example configuration: cp .env.example .env.local
3. Set the environment variables needed for the features you want to run. Some integrations and administrative routes require additional credentials or service-account configuration.
4. Start the development server: npm run dev
Useful commands:
Command	Purpose
npm run dev	Run the development server
npm run build	Create the frontend production build
npm run preview	Preview the frontend build
npm run lint	Run TypeScript checks (tsc --noEmit)
npm run test	Run the configured Vitest command


Note: The automated test suite is still being expanded; the presence of a test command does not imply complete test coverage.
Engineering approach
I treat this as an evolving product rather than a static portfolio demo. The focus is on:
- Translating real business requirements into maintainable features.
- Keeping calculation rules and integrations understandable and testable.
- Applying TypeScript types across frontend and backend code.
- Managing access control and configuration across environments.
- Using CI/CD and controlled deployments to reduce release risk.
- Using AI as a development accelerator while retaining human review of correctness, security, and maintainability.
The project was initially bootstrapped with Google AI Studio and has evolved with custom application features, integrations, and operational workflows.
Current priorities
- Expand automated unit and integration test coverage.
- Refactor larger feature screens into smaller components and services.
- Improve technical documentation and local onboarding.
- Continue hardening third-party integrations, access control, and release validation.
About this repository
This is a personal project, separate from my previous enterprise work. Most of my professional code is held in private company repositories due to confidentiality requirements. I have made LabLayer available temporarily to illustrate my hands-on work with React, TypeScript, APIs, application architecture, and deployment workflows.
