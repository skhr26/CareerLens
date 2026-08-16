import {router} from './app.routes.jsx'
import {RouterProvider} from 'react-router-dom'
import { AuthProvider } from './features/auth/auth.context.jsx'
import { InterviewProvider } from './features/ai/interviewContext.jsx'
function App() {

  return (
    <>
    {/* Providers wrap the app so features can use their contexts */}
    <AuthProvider>
      <InterviewProvider>
        <RouterProvider router={router} />
      </InterviewProvider>
    </AuthProvider>
    
    </>
  )
}

export default App
