import {router} from './app.routes.jsx'
import {RouterProvider} from 'react-router-dom'
import { AuthProvider } from './features/auth/auth.context.jsx'
function App() {

  return (
    <>
    {/* now the router will be able to access all the data inside the authprovideer */}
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
    
    </>
  )
}

export default App
