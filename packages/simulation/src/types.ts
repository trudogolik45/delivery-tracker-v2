export type Position = { lat: number; lng: number }
export type Segment =
  | { type: 'driving'; tStart: number; tEnd: number; distStart: number; distEnd: number }
  | { type: 'rest'; tStart: number; tEnd: number; atDist: number }