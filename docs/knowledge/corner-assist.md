# Corner speed assistance

## Reference and adaptation

Forza Horizon 5 exposes distinct assisted-braking and steering options; the official Forza article also describes speed-sensitive steering settings: https://forza.net/news/forza-horizon-5-midnights?mobile-app=true&theme=falseCampfire. This confirms that steering response and braking assistance are tunable concepts in a shipped arcade racer. The article does not publish the braking controller or establish that it applies braking from joystick heading alone.

CarWars has no racing line or route target, so the adaptation uses only the driver's requested heading. `directionalInput()` lowers target speed as heading error grows, brakes only when the car exceeds that target, and resumes throttle as alignment improves. A `cornerAssist: false` input option retains the prior heading-speed curve for deliberate driving modes. This is a CarWars heuristic, not a reconstruction of Forza physics.

## Measured scenario

The automated test settles the car, sets 40, 60, or 80 km/h in its forward direction, then requests a 90-degree turn for 1.5 seconds at 120 Hz. It repeats both turn directions and compares the new assistance with the previous speed curve. It measures mean absolute lateral velocity, speed, heading progress, roll, and grounded wheels. See `tests/driving-input.test.js` for the reproducible scenario.
