/**
 * A dashboard is made of independent sections (today's classes, the to-do list, ...). Each section
 * runs on its own: if one fails it comes back as null with a short message in `errors`, and the
 * rest of the page still loads. The real error is logged, never sent to the browser.
 */
export type SectionErrors<K extends string> = Partial<Record<K, string>>;

export async function runSections<T extends Record<string, () => Promise<unknown>>>(
  sections: T,
): Promise<{ data: { [K in keyof T]: Awaited<ReturnType<T[K]>> | null }; errors: SectionErrors<Extract<keyof T, string>> }> {
  const names = Object.keys(sections) as Array<Extract<keyof T, string>>;
  const settled = await Promise.allSettled(names.map((name) => sections[name]()));

  const data = {} as { [K in keyof T]: Awaited<ReturnType<T[K]>> | null };
  const errors: SectionErrors<Extract<keyof T, string>> = {};
  names.forEach((name, i) => {
    const result = settled[i];
    if (result.status === 'fulfilled') {
      data[name] = result.value as Awaited<ReturnType<T[typeof name]>>;
    } else {
      console.error(`[dashboard] section "${name}" failed:`, result.reason);
      data[name] = null;
      errors[name] = 'This section could not be loaded.';
    }
  });
  return { data, errors };
}

/** The school's timezone: "today" and the weekday are always worked out here, never in the database's (UTC). */
export const SCHOOL_TIMEZONE = 'Asia/Manila';
