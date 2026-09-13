// Where the order is picked up and delivered: the build sheet's "Order placed carries items, address, promised time".
// The platform knows the restaurant's address when it creates the order; the customer gives the delivery one.
export const PICKUPS = {
  r1: { address: "12 Camden Street Lower, Dublin 2", location: { type: "Point", coordinates: [-6.2645, 53.3347] } },
  r2: { address: "45 Capel Street, Dublin 1", location: { type: "Point", coordinates: [-6.2686, 53.3478] } },
  r3: { address: "3 Ranelagh Road, Dublin 6", location: { type: "Point", coordinates: [-6.2545, 53.3268] } },
};
// The hubs themselves: a courier hub is a real unit at a real address, and
// couriers wait at it between deliveries. Before these existed dispatch used a
// made-up offset from the city centre, which put hub-1's waiting couriers in
// the middle of Phoenix Park.
// router_port is where the platform's own routing service answers, on the host
// the fleet runs on. A courier app builds the URL from the address it already
// has for the hub, so no machine's address is written down in the data.
export const ROUTER_PORT = 18010;
export const HUBS = {
  "hub-1": { name: "Dublin south hub", address: "Unit 4, Newmarket, Dublin 8", location: { type: "Point", coordinates: [-6.2783, 53.3372] }, router_port: ROUTER_PORT },
  "hub-2": { name: "Dublin north hub", address: "Unit 9, Sheriff Street Upper, Dublin 1", location: { type: "Point", coordinates: [-6.2402, 53.3506] }, router_port: ROUTER_PORT },
};
export const DELIVERIES = [
  { address: "8 Fitzwilliam Square, Dublin 2", location: { type: "Point", coordinates: [-6.2519, 53.3348] } },
  { address: "22 Pearse Street, Dublin 2", location: { type: "Point", coordinates: [-6.2508, 53.3441] } },
  { address: "5 Leeson Street Upper, Dublin 4", location: { type: "Point", coordinates: [-6.2530, 53.3297] } },
  { address: "31 Parnell Square, Dublin 1", location: { type: "Point", coordinates: [-6.2645, 53.3535] } },
  { address: "14 Wexford Street, Dublin 2", location: { type: "Point", coordinates: [-6.2655, 53.3365] } },
  { address: "2 Herbert Place, Dublin 2", location: { type: "Point", coordinates: [-6.2453, 53.3350] } },
  { address: "19 Smithfield, Dublin 7", location: { type: "Point", coordinates: [-6.2781, 53.3480] } },
  { address: "7 Grand Canal Street, Dublin 2", location: { type: "Point", coordinates: [-6.2400, 53.3380] } },
];
export const delivery = (i) => DELIVERIES[i % DELIVERIES.length];
