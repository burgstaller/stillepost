/**
 * Created by florian on 17.11.14.
 */

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;


public class ConnectionListener {

    public static void main(String[] args)
    {

    }

    public static void startEntryConnection(int port) throws IOException
    {
        ServerSocket mainSocket = new ServerSocket(port);
        Socket client = null;


        while ((client = mainSocket.accept()) != null) {
            //TODO Wait for connection/request from browser and invote ConnectionHandler
        }

    }

    public static void startIntermediateConnection(int port)
    {
        //TODO listen on given port untill nextnode sends connection open
    }




}
