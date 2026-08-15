import { useNavigate } 
from "react-router-dom"; import EventForm 
from "../components/EventForm.jsx"; export default 
function CreateEventPage() { const navigate = useNavigate();
     return ( <div className="create-event-page"> <h1>Create an event</h1> <EventForm
 onSaved={(event) => { navigate(`/events/${event.slug ?? event.id}`); }} /> </div> ); }