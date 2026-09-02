import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/core-docx';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

/**
 * The reference example for a plugin that calls a real API.
 *
 * Weather comes from Open-Meteo (https://open-meteo.com) — free, no key, no
 * attribution requirement — over two endpoints: a geocoding search that turns
 * a city name into coordinates, then the forecast itself. Everything it needs
 * is in the two hosts below, which is the point of the example: a plugin
 * should be able to name what it talks to.
 *
 * In the playground this runs inside the browser sandbox, so both hosts have
 * to be listed against the plugin's Network switch before either call is
 * allowed. On disk it runs in Node, where `fetch` is global from 18 on.
 */

/** The hosts this component calls. Paste these into its Network allowlist. */
export const WEATHER_API_HOSTS = [
  'https://geocoding-api.open-meteo.com',
  'https://api.open-meteo.com',
] as const;

const GEOCODING_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/** Give up rather than hold a document build open on a slow network. */
const REQUEST_TIMEOUT_MS = 8000;

const UnitsSchema = Type.Optional(
  Type.Union([Type.Literal('metric'), Type.Literal('imperial')], {
    default: 'metric',
    description: 'metric = °C and km/h, imperial = °F and mph',
  })
);

const WeatherV1PropsSchema = Type.Object(
  {
    city: Type.String({
      minLength: 1,
      description: 'City to look up, e.g. "Milan" or "Milan, Italy"',
    }),
    units: UnitsSchema,
    showDetails: Type.Optional(
      Type.Boolean({
        default: true,
        description: 'Show humidity, wind and pressure under the reading',
      })
    ),
  },
  { additionalProperties: false }
);

const WeatherV2PropsSchema = Type.Object(
  {
    city: Type.String({
      minLength: 1,
      description: 'City to look up, e.g. "Milan" or "Milan, Italy"',
    }),
    units: UnitsSchema,
    days: Type.Optional(
      Type.Number({
        default: 3,
        minimum: 1,
        maximum: 7,
        description: 'Number of forecast days (1-7)',
      })
    ),
  },
  { additionalProperties: false }
);

// ---------------------------------------------------------------------------
// Open-Meteo
// ---------------------------------------------------------------------------

/** WMO 4677 weather codes, as Open-Meteo returns them in `weather_code`. */
const WEATHER_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

function describeCode(code: unknown): string {
  return typeof code === 'number' && WEATHER_CODES[code]
    ? WEATHER_CODES[code]
    : 'Unknown conditions';
}

export class WeatherLookupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherLookupError';
  }
}

/**
 * One JSON GET, with a deadline and an error a document author can act on.
 * A failed call throws: rendering half a weather block is worse than saying
 * why there is none.
 */
async function getJson(url: string, what: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WeatherLookupError(
      `Could not reach Open-Meteo for ${what}: ${reason}. In the playground, list ${WEATHER_API_HOSTS.join(' and ')} under this plugin's Network switch.`
    );
  }
  if (!response.ok) {
    throw new WeatherLookupError(
      `Open-Meteo answered ${response.status} for ${what}.`
    );
  }
  return response.json();
}

interface Place {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
}

/** City name to coordinates. The first match wins, as the API ranks them. */
async function geocode(city: string): Promise<Place> {
  const url = `${GEOCODING_URL}?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;
  const body = (await getJson(url, `"${city}"`)) as {
    results?: Array<Record<string, unknown>>;
  };
  const first = body.results?.[0];
  if (!first || typeof first.latitude !== 'number') {
    throw new WeatherLookupError(
      `Open-Meteo has no place called "${city}". Try adding a country, e.g. "${city}, Italy".`
    );
  }
  return {
    name: String(first.name ?? city),
    country: typeof first.country === 'string' ? first.country : undefined,
    admin1: typeof first.admin1 === 'string' ? first.admin1 : undefined,
    latitude: first.latitude,
    longitude: first.longitude as number,
    timezone: typeof first.timezone === 'string' ? first.timezone : undefined,
  };
}

/** "Milan, Lombardy, Italy" — as much as the API knew. */
function placeLabel(place: Place): string {
  return [place.name, place.admin1, place.country].filter(Boolean).join(', ');
}

function unitParams(units: string): string {
  return units === 'imperial'
    ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch'
    : '';
}

export interface CurrentWeather {
  temperature: number;
  apparent: number;
  conditions: string;
  humidity: number;
  windSpeed: number;
  pressure: number;
  observedAt: string;
}

async function fetchCurrent(
  place: Place,
  units: string
): Promise<CurrentWeather> {
  const url =
    `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,surface_pressure,weather_code' +
    `&timezone=auto${unitParams(units)}`;
  const body = (await getJson(url, `weather in ${place.name}`)) as {
    current?: Record<string, unknown>;
  };
  const current = body.current;
  if (!current || typeof current.temperature_2m !== 'number') {
    throw new WeatherLookupError(
      `Open-Meteo returned no current reading for ${place.name}.`
    );
  }
  const round = (value: unknown, fallback = 0): number =>
    typeof value === 'number' ? Math.round(value) : fallback;
  return {
    temperature: Math.round(current.temperature_2m),
    apparent: round(
      current.apparent_temperature,
      Math.round(current.temperature_2m)
    ),
    conditions: describeCode(current.weather_code),
    humidity: round(current.relative_humidity_2m),
    windSpeed: round(current.wind_speed_10m),
    pressure: round(current.surface_pressure),
    observedAt: typeof current.time === 'string' ? current.time : '',
  };
}

export interface ForecastDay {
  date: string;
  high: number;
  low: number;
  conditions: string;
  precipitation: number;
}

async function fetchForecast(
  place: Place,
  units: string,
  days: number
): Promise<ForecastDay[]> {
  const url =
    `${FORECAST_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    `&forecast_days=${days}&timezone=auto${unitParams(units)}`;
  const body = (await getJson(url, `the forecast for ${place.name}`)) as {
    daily?: Record<string, unknown[]>;
  };
  const daily = body.daily;
  const dates = daily?.time;
  if (!Array.isArray(dates) || dates.length === 0) {
    throw new WeatherLookupError(
      `Open-Meteo returned no forecast for ${place.name}.`
    );
  }
  const at = (key: string, i: number): unknown => daily?.[key]?.[i];
  return dates.slice(0, days).map((date, i) => ({
    date: String(date),
    high: Math.round(Number(at('temperature_2m_max', i) ?? 0)),
    low: Math.round(Number(at('temperature_2m_min', i) ?? 0)),
    conditions: describeCode(at('weather_code', i)),
    precipitation: Math.round(
      Number(at('precipitation_probability_max', i) ?? 0)
    ),
  }));
}

/** "Mon 14 Oct" from an ISO date, without pulling in a date library. */
function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Live weather, from Open-Meteo.
 *
 * @example
 * ```json
 * {
 *   "name": "weather",
 *   "props": { "city": "Milan", "units": "metric", "showDetails": true }
 * }
 * ```
 */
export const weatherComponent = createComponent({
  name: 'weather',
  versions: {
    '1.0.0': createVersion({
      propsSchema: WeatherV1PropsSchema,
      description:
        'Current weather for a city, fetched live from Open-Meteo (needs network access to api.open-meteo.com and geocoding-api.open-meteo.com)',

      render: async ({ props, addWarning }) => {
        const units = props.units ?? 'metric';
        const place = await geocode(props.city);
        const weather = await fetchCurrent(place, units);
        addWarning(`Fetched live weather from Open-Meteo`, {
          place: placeLabel(place),
          observedAt: weather.observedAt,
        });

        const degrees = units === 'imperial' ? '°F' : '°C';
        const speed = units === 'imperial' ? 'mph' : 'km/h';

        const components: ComponentDefinition[] = [
          {
            name: 'heading',
            props: { level: 3, text: `Weather in ${placeLabel(place)}` },
          },
          {
            name: 'paragraph',
            props: {
              text: `${weather.temperature}${degrees} — ${weather.conditions}`,
              font: { bold: true, size: 14 },
            },
          },
        ];

        if (props.showDetails ?? true) {
          components.push({
            name: 'list',
            props: {
              items: [
                `Feels like: ${weather.apparent}${degrees}`,
                `Humidity: ${weather.humidity}%`,
                `Wind: ${weather.windSpeed} ${speed}`,
                `Pressure: ${weather.pressure} hPa`,
              ],
            },
          });
        }

        components.push({
          name: 'paragraph',
          props: {
            text: `Source: Open-Meteo${weather.observedAt ? `, observed ${weather.observedAt.replace('T', ' ')}` : ''}`,
            font: { size: 8, italic: true },
          },
        });

        return components;
      },
    }),

    '2.0.0': createVersion({
      propsSchema: WeatherV2PropsSchema,
      description:
        'Multi-day forecast table for a city, fetched live from Open-Meteo',

      render: async ({ props, addWarning }) => {
        const units = props.units ?? 'metric';
        const days = props.days ?? 3;
        const place = await geocode(props.city);
        const forecast = await fetchForecast(place, units, days);
        addWarning('Fetched live forecast from Open-Meteo', {
          place: placeLabel(place),
          days: forecast.length,
        });

        const degrees = units === 'imperial' ? '°F' : '°C';

        return [
          {
            name: 'heading',
            props: {
              level: 3,
              text: `${forecast.length}-day forecast for ${placeLabel(place)}`,
            },
          },
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: 'Day' },
                  cells: forecast.map((day) => ({
                    content: formatDay(day.date),
                  })),
                },
                {
                  header: { content: `High (${degrees})` },
                  cells: forecast.map((day) => ({ content: String(day.high) })),
                },
                {
                  header: { content: `Low (${degrees})` },
                  cells: forecast.map((day) => ({ content: String(day.low) })),
                },
                {
                  header: { content: 'Rain' },
                  cells: forecast.map((day) => ({
                    content: `${day.precipitation}%`,
                  })),
                },
                {
                  header: { content: 'Conditions' },
                  cells: forecast.map((day) => ({ content: day.conditions })),
                },
              ],
            },
          },
          {
            name: 'paragraph',
            props: {
              text: 'Source: Open-Meteo',
              font: { size: 8, italic: true },
            },
          },
        ] satisfies ComponentDefinition[];
      },
    }),
  },
});
