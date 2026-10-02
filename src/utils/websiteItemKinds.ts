/**
 * Describes one kind of record that belongs to a website. Use cases and
 * actions have the same shape (title + description) and the same pages, so
 * the generic `WebsiteItem*` pages and components take one of these to know
 * which kind they are showing - what to call it and which URL segment it lives
 * under.
 */
export interface WebsiteItemKind {
  /** Stable identifier, used to build React keys. */
  kindId: "useCase" | "action";
  /** Lowercase singular, for running text: "use case". */
  singularLabel: string;
  /** Lowercase plural, for running text: "use cases". */
  pluralLabel: string;
  /** Capitalized singular, for headings: "Use case". */
  singularTitle: string;
  /** Capitalized plural, for headings: "Use cases". */
  pluralTitle: string;
  /**
   * The URL segment under `/websites/:websiteId/`, shared by the page routes
   * and the API routes: `/websites/:id/use-cases` and `/api/websites/:id/use-cases`.
   */
  pathSegment: "use-cases" | "actions";
}

/** Use cases: scenarios to test on a website. */
export const USE_CASE_KIND: WebsiteItemKind = {
  kindId: "useCase",
  singularLabel: "use case",
  pluralLabel: "use cases",
  singularTitle: "Use case",
  pluralTitle: "Use cases",
  pathSegment: "use-cases",
};

/** Actions: reusable steps on a website, such as logging in. */
export const ACTION_KIND: WebsiteItemKind = {
  kindId: "action",
  singularLabel: "action",
  pluralLabel: "actions",
  singularTitle: "Action",
  pluralTitle: "Actions",
  pathSegment: "actions",
};

/** Props for the use case / action pages: which kind of item the page is for. */
export interface WebsiteItemPageProps {
  /** `USE_CASE_KIND` or `ACTION_KIND`. */
  itemKind: WebsiteItemKind;
}
