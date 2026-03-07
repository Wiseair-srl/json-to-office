import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

/**
 * v1 props schema
 */
const WeatherV1PropsSchema = Type.Object(
  {
    city: Type.String({
      description: 'City name for weather data',
    }),
    units: Type.Optional(
      Type.Union([Type.Literal('metric'), Type.Literal('imperial')], {
        default: 'metric',
        description: 'Temperature units',
      })
    ),
    showDetails: Type.Optional(
      Type.Boolean({
        default: true,
        description: 'Show detailed weather information',
      })
    ),
  },
  {
    additionalProperties: false,
  }
);

/**
 * v2 props schema — adds multi-day forecast support
 */
const WeatherV2PropsSchema = Type.Object(
  {
    city: Type.String({
      description: 'City name for weather data',
    }),
    units: Type.Optional(
      Type.Union([Type.Literal('metric'), Type.Literal('imperial')], {
        default: 'metric',
        description: 'Temperature units',
      })
    ),
    days: Type.Optional(
      Type.Number({
        default: 1,
        minimum: 1,
        maximum: 5,
        description: 'Number of forecast days (1-5)',
      })
    ),
  },
  {
    additionalProperties: false,
  }
);

/**
 * Mock weather API response
 */
interface WeatherData {
  temperature: number;
  description: string;
  humidity: number;
  windSpeed: number;
  pressure: number;
}

/**
 * Mock function to fetch weather data
 * In a real implementation, this would call an actual weather API
 */
async function fetchWeather(city: string, units: string): Promise<WeatherData> {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Return mock data based on city
  const mockData: Record<string, WeatherData> = {
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
    mockData[city] || {
      temperature: units === 'imperial' ? 70 : 21,
      description: 'Clear',
      humidity: 50,
      windSpeed: units === 'imperial' ? 7 : 11,
      pressure: 1013,
    }
  );
}

/**
 * Mock multi-day forecast for v2
 */
async function fetchForecast(
  city: string,
  units: string,
  days: number
): Promise<
  Array<{ day: string; high: number; low: number; description: string }>
> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const base = units === 'imperial' ? 65 : 18;
  return dayNames.slice(0, days).map((day, i) => ({
    day,
    high: base + (5 - i) * (units === 'imperial' ? 2 : 1),
    low: base - (3 + i) * (units === 'imperial' ? 2 : 1),
    description: ['Sunny', 'Partly cloudy', 'Cloudy', 'Showers', 'Clear'][i],
  }));
}

/**
 * Weather component that fetches and displays weather information
 *
 * @example
 * ```json
 * {
 *   "name": "weather",
 *   "props": {
 *     "city": "London",
 *     "units": "metric",
 *     "showDetails": true
 *   }
 * }
 * ```
 */
export const weatherComponent = createComponent({
  name: 'weather',
  versions: {
    '1.0.0': createVersion({
      propsSchema: WeatherV1PropsSchema,
      description: 'Displays current weather information for a city',

      render: async ({ props, addWarning }) => {
        const weather = await fetchWeather(props.city, props.units || 'metric');
        addWarning('Fetched weather data', { city: props.city });
        const tempUnit = props.units === 'imperial' ? '°F' : '°C';
        const speedUnit = props.units === 'imperial' ? 'mph' : 'km/h';

        const components: ComponentDefinition[] = [
          {
            name: 'heading',
            props: {
              level: 3,
              text: `Weather in ${props.city}`,
            },
          },
          {
            name: 'paragraph',
            props: {
              text: `${weather.temperature}${tempUnit} - ${weather.description}`,
              font: { bold: true, size: 14 },
            },
          },
        ];

        if (props.showDetails) {
          components.push({
            name: 'list',
            props: {
              items: [
                `Humidity: ${weather.humidity}%`,
                `Wind Speed: ${weather.windSpeed} ${speedUnit}`,
                `Pressure: ${weather.pressure} hPa`,
              ],
            },
          });
        }

        return components;
      },
    }),

    '2.0.0': createVersion({
      propsSchema: WeatherV2PropsSchema,
      description: 'Multi-day forecast displayed as a table',

      render: async ({ props, addWarning }) => {
        const units = props.units || 'metric';
        const days = props.days || 3;
        const tempUnit = units === 'imperial' ? '°F' : '°C';

        const forecast = await fetchForecast(props.city, units, days);
        addWarning('Fetched forecast data', { city: props.city, days });

        const components: ComponentDefinition[] = [
          {
            name: 'heading',
            props: {
              level: 3,
              text: `${days}-Day Forecast for ${props.city}`,
            },
          },
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: 'Day' },
                  cells: forecast.map((f) => ({ content: f.day })),
                },
                {
                  header: { content: `High (${tempUnit})` },
                  cells: forecast.map((f) => ({ content: String(f.high) })),
                },
                {
                  header: { content: `Low (${tempUnit})` },
                  cells: forecast.map((f) => ({ content: String(f.low) })),
                },
                {
                  header: { content: 'Conditions' },
                  cells: forecast.map((f) => ({ content: f.description })),
                },
              ],
            },
          },
        ];

        return components;
      },
    }),
  },
});
