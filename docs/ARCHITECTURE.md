# Panthorium Architecture

## Components

```text
Browser / sentinel.html
  -> Auth boundary (guest/admin access token)
  -> Express API
       -> Auth + Permission middleware
       -> Rate limit + Validation + Audit
       -> Sentinel Core
            -> SessionManager
            -> PromptManager
            -> ProviderManager
                 -> Groq / OpenAI / Gemini / Anthropic
```

UI/CSS/desktop/window manager เดิมยังอยู่ใน `sentinel.html` เพื่อไม่เปลี่ยนประสบการณ์ผู้ใช้ ขณะที่ backend แยกเป็น `routes/`, `middleware/`, `services/`, `repositories/`, `config/`.

## Data

`JsonStore` ใช้กับ users และ hashed refresh tokens เพื่อให้ deploy ได้ง่ายโดยไม่ต้องใช้ native database driver. Production ที่มีผู้ใช้จำนวนมากควรเปลี่ยน repository implementation เป็น PostgreSQL และเปลี่ยน SessionManager เป็น Redis โดยไม่ต้องเปลี่ยน route/API contract.
