// Where the order is picked up and delivered: the build sheet's "Order placed carries items, address, promised time".
// The platform knows the restaurant's address when it creates the order; the customer gives the delivery one.
export const PICKUPS = {
  r1: { address: "12 Camden Street Lower, Dublin 2", location: { type: "Point", coordinates: [-6.2645, 53.3347] } },
  r2: { address: "45 Capel Street, Dublin 1", location: { type: "Point", coordinates: [-6.2686, 53.3478] } },
  r3: { address: "3 Ranelagh Road, Dublin 6", location: { type: "Point", coordinates: [-6.2545, 53.3268] } },
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
