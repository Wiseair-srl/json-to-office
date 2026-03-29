import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '@json-to-office/shared/plugin';
import type { PptxComponentInput } from '../../types';

/**
 * v1 props — current weather for a single city
 */
const WeatherV1PropsSchema = Type.Object(
  {
    city: Type.String({ description: 'City name for weather data' }),
    units: Type.Optional(
      Type.Union([Type.Literal('metric'), Type.Literal('imperial')], {
        default: 'metric',
        description: 'Temperature units',
      })
    ),
    showDetails: Type.Optional(
      Type.Boolean({
        default: true,
        description: 'Show humidity / wind / pressure below the main reading',
      })
    ),
  },
  { additionalProperties: false }
);

/**
 * v2 props — multi-day forecast table
 */
const WeatherV2PropsSchema = Type.Object(
  {
    city: Type.String({ description: 'City name for weather data' }),
    units: Type.Optional(
      Type.Union([Type.Literal('metric'), Type.Literal('imperial')], {
        default: 'metric',
        description: 'Temperature units',
      })
    ),
    days: Type.Optional(
      Type.Number({
        default: 3,
        minimum: 1,
        maximum: 5,
        description: 'Number of forecast days (1-5)',
      })
    ),
  },
  { additionalProperties: false }
);

// ---- Mock API layer ----

interface WeatherData {
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
  pressure: number;
}

async function fetchWeather(city: string, units: string): Promise<WeatherData> {
  await new Promise((r) => setTimeout(r, 50));

  const data: Record<string, WeatherData> = {
    London: {
      temperature: units === 'imperial' ? 59 : 15,
      description: 'Partly cloudy',
      humidity: 65,
      windSpeed: units === 'imperial' ? 10 : 16,
      pressure: 1013,
    },
    'New York': {
      temperature: units === 'imperial' ? 72 : 22,
      description: 'Sunny',
      humidity: 45,
      windSpeed: units === 'imperial' ? 8 : 13,
      pressure: 1015,
    },
    Tokyo: {
      temperature: units === 'imperial' ? 68 : 20,
      description: 'Clear',
      humidity: 55,
      windSpeed: units === 'imperial' ? 5 : 8,
      pressure: 1012,
    },
  };

  return (
    data[city] ?? {
      temperature: units === 'imperial' ? 70 : 21,
      description: 'Clear',
      humidity: 50,
      windSpeed: units === 'imperial' ? 7 : 11,
      pressure: 1013,
    }
  );
}

async function fetchForecast(
  city: string,
  units: string,
  days: number
): Promise<
  Array<{ day: string; high: number; low: number; description: string }>
> {
  await new Promise((r) => setTimeout(r, 50));
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const base = units === 'imperial' ? 65 : 18;
  return dayNames.slice(0, days).map((day, i) => ({
    day,
    high: base + (5 - i) * (units === 'imperial' ? 2 : 1),
    low: base - (3 + i) * (units === 'imperial' ? 2 : 1),
    description: ['Sunny', 'Partly cloudy', 'Cloudy', 'Showers', 'Clear'][i],
  }));
}

// ---- Component ----

/**
 * Weather component for PPTX presentations.
 *
 * v1 renders a title + temperature reading + optional detail lines.
 * v2 renders a title + multi-day forecast table.
 *
 * @example
 * ```json
 * {
 *   "name": "weather",
 *   "props": { "city": "London", "units": "metric", "showDetails": true }
 * }
 * ```
 */
export const weatherComponent = createComponent({
  name: 'weather' as const,
  versions: {
    '1.0.0': createVersion<typeof WeatherV1PropsSchema, PptxComponentInput>({
      propsSchema: WeatherV1PropsSchema,
      description: 'Current weather for a single city',

      render: async ({ props, addWarning }) => {
        const units = props.units ?? 'metric';
        const weather = await fetchWeather(props.city, units);
        addWarning('Using mock weather data — replace with real API', {
          city: props.city,
        });

        const tempUnit = units === 'imperial' ? '\u00b0F' : '\u00b0C';
        const speedUnit = units === 'imperial' ? 'mph' : 'km/h';

        const components: PptxComponentInput[] = [
          {
            name: 'text',
            props: {
              text: `Weather in ${props.city}`,
              x: 0.5,
              y: 0.5,
              w: 9,
              h: 0.6,
              fontSize: 24,
              bold: true,
            },
          },
          {
            name: 'text',
            props: {
              text: `${weather.temperature}${tempUnit} \u2014 ${weather.description}`,
              x: 0.5,
              y: 1.2,
              w: 9,
              h: 0.5,
              fontSize: 18,
            },
          },
        ];

        if (props.showDetails) {
          components.push({
            name: 'text',
            props: {
              text: [
                `Humidity: ${weather.humidity}%`,
                `Wind: ${weather.windSpeed} ${speedUnit}`,
                `Pressure: ${weather.pressure} hPa`,
              ].join('  |  '),
              x: 0.5,
              y: 1.8,
              w: 9,
              h: 0.4,
              fontSize: 12,
              color: '666666',
            },
          });
        }

        return components;
      },
    }),

    '2.0.0': createVersion<typeof WeatherV2PropsSchema, PptxComponentInput>({
      propsSchema: WeatherV2PropsSchema,
      description: 'Multi-day forecast displayed as a table',

      render: async ({ props, addWarning }) => {
        const units = props.units ?? 'metric';
        const days = props.days ?? 3;
        const tempUnit = units === 'imperial' ? '\u00b0F' : '\u00b0C';

        const forecast = await fetchForecast(props.city, units, days);
        addWarning('Using mock forecast data — replace with real API', {
          city: props.city,
          days,
        });

        const headerRow = [
          { text: 'Day', bold: true, fill: 'E8E8E8' },
          { text: `High (${tempUnit})`, bold: true, fill: 'E8E8E8' },
          { text: `Low (${tempUnit})`, bold: true, fill: 'E8E8E8' },
          { text: 'Conditions', bold: true, fill: 'E8E8E8' },
        ];

        const dataRows = forecast.map((f) => [
          f.day,
          String(f.high),
          String(f.low),
          f.description,
        ]);

        const components: PptxComponentInput[] = [
          {
            name: 'text',
            props: {
              text: `${days}-Day Forecast for ${props.city}`,
              x: 0.5,
              y: 0.5,
              w: 9,
              h: 0.6,
              fontSize: 24,
              bold: true,
            },
          },
          {
            name: 'table',
            props: {
              rows: [headerRow, ...dataRows],
              x: 0.5,
              y: 1.3,
              w: 9,
              fontSize: 12,
              border: { type: 'solid', pt: 0.5, color: 'CCCCCC' },
            },
          },
        ];

        return components;
      },
    }),
  },
});
