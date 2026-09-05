import { MapPin } from 'lucide-react';
import { formatLocation, isFieldBooked } from '../lib/location';

interface SessionLocationProps {
  locationArea: string;
  locationName: string;
  locationUrl: string;
  className?: string;
}

/**
 * Renders wherever the game is, at whatever certainty is currently known —
 * "Mississauga — specific field TBD" before the permit is booked, the actual
 * diamond (linked to a map, if there is one) afterwards. Renders nothing when
 * no area has been set yet, rather than an empty placeholder.
 */
export function SessionLocation({ locationArea, locationName, locationUrl, className = '' }: SessionLocationProps) {
  const parts = { area: locationArea, name: locationName, url: locationUrl };
  const text = formatLocation(parts);
  if (!text) return null;

  const booked = isFieldBooked(parts);

  return (
    <p className={`flex items-start gap-1.5 text-sm ${booked ? 'text-slate-700' : 'text-slate-500'} ${className}`}>
      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {locationUrl ? (
        <a href={locationUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          {text}
        </a>
      ) : (
        <span>{text}</span>
      )}
    </p>
  );
}
