import { dateInTimeZone } from "@/lib/dates";
import { expireCompOff } from "@/server/modules/compoff/service";
import type { JobDefinition } from "./registry";

export const compOffExpireJob: JobDefinition = {
  name: "compoff:expire",
  description: "Lapses comp-off that has passed its expiry date and warns employees a week before theirs expires.",
  runKey: (now, timeZone) => dateInTimeZone(now, timeZone),
  run: (db, now, timeZone) => {
    const { expired, warned } = expireCompOff(db, dateInTimeZone(now, timeZone));
    return `Expired ${expired} comp-off lot(s); warned ${warned} employee(s)`;
  },
};
