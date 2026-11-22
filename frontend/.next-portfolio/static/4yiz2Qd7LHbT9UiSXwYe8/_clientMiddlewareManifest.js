self.__MIDDLEWARE_MATCHERS = [
  {
    "missing": [
      {
        "type": "header",
        "key": "next-router-prefetch"
      },
      {
        "type": "header",
        "key": "purpose",
        "value": "prefetch"
      }
    ],
    "regexp": "^(?:\\/(_next\\/data\\/[^/]{1,}))?(?:\\/((?!_next\\/static|_next\\/image|maplibre|favicon.ico|robots.txt|sitemap.xml).*))(\\.json|\\.rsc|\\.segments\\/.+\\.segment\\.rsc)?[\\/#\\?]?$",
    "originalSource": "/((?!_next/static|_next/image|maplibre|favicon.ico|robots.txt|sitemap.xml).*)"
  }
];self.__MIDDLEWARE_MATCHERS_CB && self.__MIDDLEWARE_MATCHERS_CB()