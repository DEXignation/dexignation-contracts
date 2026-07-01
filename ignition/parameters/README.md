# Ignition Parameters

Set `adminSafe` per network before deploying the trading module.

```json
{
  "DXDeployTradingPolygon": {
    "adminSafe": "0xYourSafeAddress"
  }
}
```

The key must match the Ignition module name:

- `local.json`: `DXDeployTrading`
- `amoy.json`: `DXDeployTradingAmoy`
- `polygon.json`: `DXDeployTradingPolygon`

Do not deploy Amoy or Polygon with the placeholder address.
