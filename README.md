# Oyo Eats

Food delivery for Sri Lanka: one mobile app with four role-based faces (customer, rider, restaurant, admin/dispatch) on a single API. A built-from-scratch replacement for the old `delivery-app`.

## Docs

- [PRD v1](docs/PRD-v1.md): full product requirements. This is the baseline.
- [Decisions](docs/DECISIONS.md): stack and scope decisions, plus what's still open.
- [Roadmap](docs/ROADMAP.md): build order and milestone checklists.
- Design canvas (67 screens): https://claude.ai/code/artifact/bcb0cd8a-5a29-4087-90ba-99b2d43e43fc

## Layout

```
oyo-eats/
  apps/
    mobile/     Expo (React Native) app, all four faces
    api/        NestJS API
  packages/
    shared/     Domain logic shared by app and API: money, fees, order state machine, schemas
  docs/
```

The skeleton is in place (see `CLAUDE.md` for commands). Next is the rest of Milestone 1 in the roadmap.
