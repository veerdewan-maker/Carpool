export type Profile = { id: string; name: string; created_at: string };

export type ProfilePrivate = {
  user_id: string;
  phone: string;
  home_address: string;
  car_make: string | null;
  car_color: string | null;
  car_open_seats: number | null;
};

export type Child = {
  id: string;
  parent_id: string;
  first_name: string;
  notes: string | null;
  created_at: string;
};

export type ConnectionStatus = "pending" | "accepted";
export type Connection = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: ConnectionStatus;
  created_at: string;
  requester?: Profile | null;
  addressee?: Profile | null;
};

export type Place = { id: string; owner_id: string; name: string; address: string; created_at: string };

export type RideStatus = "scheduled" | "in_progress" | "finished" | "cancelled";
export type Ride = {
  id: string;
  creator_id: string;
  series_id: string | null;
  destination_name: string;
  destination_address: string;
  starts_at: string;
  status: RideStatus;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_car: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type RiderStatus = "pending" | "accepted" | "declined";
export type RideRider = {
  id: string;
  ride_id: string;
  child_id: string;
  parent_id: string;
  status: RiderStatus;
  invited_by: string;
  child?: Pick<Child, "id" | "first_name" | "notes"> | null;
  parent?: Pick<Profile, "id" | "name"> | null;
};

export type StopKind = "pickup" | "destination" | "dropoff";
/** Row from get_ride_stops(): address is null unless the caller may see it. */
export type RideStop = {
  id: string;
  ride_id: string;
  position: number;
  kind: StopKind;
  child_id: string | null;
  child_name: string | null;
  child_notes: string | null;
  parent_id: string | null;
  parent_name: string | null;
  planned_at: string;
  completed_at: string | null;
  address: string | null;
};

export type DriverLink = {
  id: string;
  ride_id: string;
  token: string;
  created_by: string;
  revoked_at: string | null;
  created_at: string;
};

export type Notification = {
  id: string;
  user_id: string;
  ride_id: string | null;
  body: string;
  read_at: string | null;
  created_at: string;
};

export type SearchResult = {
  id: string;
  name: string;
  connection_id: string | null;
  connection_status: "none" | "accepted" | "pending_out" | "pending_in";
};

/** Shape returned by driver_link_view(token). */
export type DriverLinkView = {
  ride: {
    id: string;
    destination_name: string;
    destination_address: string;
    starts_at: string;
    status: RideStatus;
    started_at: string | null;
    driver_name: string | null;
  };
  stops: Array<{
    id: string;
    position: number;
    kind: StopKind;
    child_name: string | null;
    child_notes: string | null;
    parent_name: string | null;
    planned_at: string;
    completed_at: string | null;
    address: string | null;
  }>;
};
