- A user should be able to create a WebApp in the webapp console
  - A webapp will contain a name, a description as to the purpose of that app for context
- A user should be able to crawl a website
  - A user should be able to gather basic layout information for a website.
- Credentials, You should be able to add credentials for that specific website, should be able to add multiple credentials
  - Done: a website's Credentials section (name, description, username, encrypted password, login page URL, optional login form selectors). A crawl can be started "as" a credential: it logs in first and the run records `isLoggedIn` and which credential it used.
- A user should be able to add Actions for their website.
  - A basic action, like log in -> Go to /login enter the credentials we should use
  - Actions should have arguments/parameters that allow you to set the objects you want to target or the names of things etc
- A user should be able to add multiple UseCases to their web app.
  - A use case will have multiple predefined actions like logging in, creating or destroying things, and use credentials, and do them in order, essentially a usecase is a linked list of actions
- A use should be able to run a UseCase to see if it passes
  - Eventually we will record the passes or fails



Rules for the the playwright code generator. 

Can't do things a user can't do without the console. So you can only type, use the mouse, you cannot manipulate the DOM in ways that a user couldn't wiudl