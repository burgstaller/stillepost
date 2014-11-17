import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.net.Socket;

/**
 * Created by florian on 17.11.14.
 *
 */
public class ConnectionHandler{


    public void IntermediateConnectionHandler() {
    }


    /*
     *  Handle communication between onion routing nodes
     *  Handles the communication between three nodes
     *  Handles all communication but the entry point:
     *  localProxy <--> n1 <--> n2 <--> exit <--> server
     *                  ^--------^-------^                  <-- One Invocation
     *                  |                |
     *                  |        ^-------^---------^        <-- One Invocation
     *                  |        |       |         |
     *                  |        |       |         |
     *                  |      prevNode  |    nextNode
     *                  |                |
     *                 prevNode        nextNode
     *
     *  n2 and  exit in the above figure call this method
     *
     */
    public void handleIntermediateCommunication(Socket previousNodeSocket, Socket nextNodeSocket) throws IOException {

        //current node streams
        final ObjectInputStream streamFromClient = new ObjectInputStream (previousNodeSocket.getInputStream());
        final ObjectOutputStream streamToClient = new ObjectOutputStream(previousNodeSocket.getOutputStream());

        //next node streams
        final ObjectInputStream streamFromServer = new ObjectInputStream(nextNodeSocket.getInputStream());
        final ObjectOutputStream streamToServer = new ObjectOutputStream(nextNodeSocket.getOutputStream());


        // create thread that forwards messages from the current peer to the
        // next peer
        final Thread toServer = new Thread() {
            public void run() {
                int bytesRead;
                int count = 0;
                try {
                    final byte[] request = new byte[1024];
                    while ((bytesRead = stream.read(request)) != -1) {

                        //TODO encryption proxy logic here
                        //TODO special case for exit node

                        streamFromServer.write(request, 0, bytesRead);
                        streamFromServer.flush();
                        count += bytesRead;
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }

                try {
                    streamFromServer.close();
                    System.out.println("client to server pipe ended, bytes transmitted: " + count);
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        };


        // create thread that forwards messages from the next peer to the
        // current peer
        final Thread toClient = new Thread() {
            public void run() {
                int bytesRead;
                int count = 0;
                try {
                    final byte[] request = new byte[1024];
                    while ((bytesRead = streamToServer.read(request)) != -1) {

                        //TODO encryption proxy logic here

                        streamToClient.write(request, 0, bytesRead);
                        streamToClient.flush();
                        count += bytesRead;
                    }
                } catch (IOException e) {
                    e.printStackTrace();
                }

                try {
                    streamToClient.close();
                    System.out.println("server to clientpipe ended, bytes transmitted: " + count);
                } catch (IOException e) {
                    e.printStackTrace();
                }
            }
        };

        toServer.start();
        toClient.start();
    }
    /*
     * Handles Communication between the local proxy and the first onion routing node
     *     localProxy <--> n1 <--> n2 <--> exit
     *          ^----------^
     *           is handled
     *
     *    n1 in the above figure calls this method
     */
    public void handleEntryCommunication(Socket entryNodeSocket, Socket nextNodeSocket){
        //TODO pack request into Request Object, send Reuqst to nextNode

        //TODO check if there is a 'CONNECT' method request --> send back 200 OK

    }

    public void requestOrigin(){
        //TODO send the request to the origin http server and send the response to the next (prevoius) node

    }


}