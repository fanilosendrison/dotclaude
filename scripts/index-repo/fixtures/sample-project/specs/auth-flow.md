---
id: SPEC-001
version: 2.3
scope: OAuth2 + session management
status: approved
depends_on: [SPEC-002]
validates: [src/auth/*]
---

# Auth Flow Specification

This spec defines the authentication flow including login, logout, and token management.

## Login

User provides email + password → server returns JWT token.

## Logout

Token is invalidated server-side.
