import { getKV, withLock } from "./store";
import { getChosenDevice, listDevices, setDeviceVolume, SpotifyError } from "./spotify";

const KEY = "ss:meeting";

export interface MeetingMode {
  active: true;
  deviceId: string;
  deviceName: string;
  originalVolume: number;
  quietVolume: number;
  applied: boolean;
}

export const getMeetingMode = () => getKV().get<MeetingMode>(KEY);

export async function setMeetingMode(enabled: boolean): Promise<MeetingMode | null> {
  return withLock("meeting", async () => {
    const saved = await getMeetingMode();
    if (!enabled) {
      if (!saved) return null;
      await setDeviceVolume(saved.deviceId, saved.originalVolume);
      await getKV().del(KEY);
      return null;
    }

    let mode = saved;
    if (!mode) {
      const [chosen, devices] = await Promise.all([getChosenDevice(), listDevices()]);
      const device = chosen ? devices.find((d) => d.id === chosen.id) : devices.find((d) => d.isActive);
      if (!device) throw new SpotifyError(409, "Open Spotify on your playback device before enabling Meeting mode");
      const volume = device.volumePercent;
      if (!device.supportsVolume || volume === null || !Number.isInteger(volume) || volume < 0 || volume > 100) {
        throw new SpotifyError(409, "This Spotify device doesn't support remote volume. Adjust its volume in Spotify instead");
      }
      mode = {
        active: true,
        deviceId: device.id,
        deviceName: device.name,
        originalVolume: volume,
        quietVolume: Math.round(volume * 0.25),
        applied: false,
      };
      // Persist the restore point before touching Spotify, even if the request is interrupted.
      await getKV().set(KEY, mode);
    }
    await setDeviceVolume(mode.deviceId, mode.quietVolume);
    const applied = { ...mode, applied: true };
    await getKV().set(KEY, applied);
    return applied;
  });
}
